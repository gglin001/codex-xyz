import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
	type ControlThread,
	type CozEvent,
	type GoalStatus,
	type ItemType,
	isSummaryEventType,
	nowIso,
	type ThreadDetail,
	type ThreadItem,
	type ThreadItemPageCursor,
	type ThreadItemPageDirection,
	type ThreadItemsPage,
	type ThreadRuntimeStatus,
	type ThreadTagScore,
	type Turn,
	type TurnStatus,
} from "./domain.js";

type Row = Record<string, unknown>;

export const currentDatabaseVersion = "v6";

const metadataTable = "metadata";
const versionKey = "version";
const defaultThreadItemPageSize = 200;
const maxThreadItemPageSize = 500;

type EventReplayOptions = {
	threadId?: string | null;
	summaryOnly?: boolean;
	limit?: number | null;
	maxPayloadBytes?: number | null;
};

type ThreadListOptions = {
	limit?: number | null;
	cursor?: {
		updatedAt: string;
		id: string;
	} | null;
	archived?: boolean | null;
};

type ThreadUpdateOptions = {
	updatedAt?: string | null;
	preserveUpdatedAt?: boolean;
};

type ThreadItemListOptions = {
	limit?: number | null;
	cursor?: ThreadItemPageCursor | null;
	direction?: ThreadItemPageDirection;
};

export type ArchiveThreadResult = {
	thread: ControlThread;
	archivedAt: string;
	changed: boolean;
};

function readJson<T>(value: unknown, fallback: T): T {
	if (typeof value !== "string" || value.length === 0) {
		return fallback;
	}
	return JSON.parse(value) as T;
}

function scalarString(value: unknown) {
	if (typeof value !== "string") {
		throw new Error("Expected string column");
	}
	return value;
}

function scalarNumber(value: unknown) {
	if (typeof value !== "number") {
		throw new Error("Expected number column");
	}
	return value;
}

function nullableString(value: unknown) {
	return typeof value === "string" ? value : null;
}

function storedThreadStatus(value: unknown): ThreadRuntimeStatus {
	const status = scalarString(value);
	if (
		status === "idle" ||
		status === "active" ||
		status === "not_loaded" ||
		status === "system_error"
	) {
		return status;
	}
	throw new Error(`Invalid thread status "${status}"`);
}

function storedTurnStatus(value: unknown): TurnStatus {
	const status = scalarString(value);
	if (
		status === "in_progress" ||
		status === "completed" ||
		status === "interrupted" ||
		status === "failed"
	) {
		return status;
	}
	throw new Error(`Invalid turn status "${status}"`);
}

function storedThreadTagScore(value: unknown): ThreadTagScore | null {
	if (value === null || value === undefined) {
		return null;
	}
	if (value === 1 || value === 2 || value === 3) {
		return value;
	}
	throw new Error(`Invalid thread tag score "${String(value)}"`);
}

function eventSummaryValue(type: string) {
	return isSummaryEventType(type) ? 1 : 0;
}

function jsonText(value: unknown) {
	return JSON.stringify(value);
}

function byteLength(value: string) {
	return Buffer.byteLength(value, "utf8");
}

function textLength(value: string) {
	return Array.from(value).length;
}

function normalizeThreadItemPageLimit(value?: number | null) {
	if (value === undefined || value === null) {
		return defaultThreadItemPageSize;
	}
	return Math.min(maxThreadItemPageSize, Math.max(1, Math.floor(value)));
}

function pageCursorFromItems(
	items: ThreadItem[],
	hasMore: boolean,
	edge: "first" | "last" = "last",
): ThreadItemPageCursor | null {
	const item = hasMore ? (edge === "first" ? items[0] : items.at(-1)) : null;
	return item ? { createdAt: item.createdAt, id: item.id } : null;
}

function threadFromRow(row: Row): ControlThread {
	return {
		id: scalarString(row.id),
		sessionId: scalarString(row.session_id),
		forkedFromId: nullableString(row.forked_from_id),
		name: scalarString(row.name),
		preview: scalarString(row.preview),
		cwd: scalarString(row.cwd),
		model: nullableString(row.model),
		status: storedThreadStatus(row.status),
		activeTurnId: nullableString(row.active_turn_id),
		lastTurnStatus: row.last_turn_status
			? storedTurnStatus(row.last_turn_status)
			: null,
		goalObjective: nullableString(row.goal_objective),
		goalStatus: nullableString(row.goal_status) as GoalStatus | null,
		goalTokenBudget:
			typeof row.goal_token_budget === "number" ? row.goal_token_budget : null,
		tokensUsed: scalarNumber(row.tokens_used),
		tagScore: storedThreadTagScore(row.tag_score),
		archivedAt: nullableString(row.archived_at),
		createdAt: scalarString(row.created_at),
		updatedAt: scalarString(row.updated_at),
	};
}

function turnFromRow(row: Row): Turn {
	return {
		id: scalarString(row.id),
		threadId: scalarString(row.thread_id),
		status: storedTurnStatus(row.status),
		prompt: scalarString(row.prompt),
		startedAt: scalarString(row.started_at),
		completedAt: nullableString(row.completed_at),
		durationMs: typeof row.duration_ms === "number" ? row.duration_ms : null,
	};
}

function itemFromRow(row: Row): ThreadItem {
	return {
		id: scalarString(row.id),
		threadId: scalarString(row.thread_id),
		turnId: nullableString(row.turn_id),
		type: scalarString(row.type) as ItemType,
		text: scalarString(row.text),
		data: readJson<Record<string, unknown>>(row.data_json, {}),
		createdAt: scalarString(row.created_at),
	};
}

function eventFromRow(row: Row): CozEvent {
	return {
		id: scalarNumber(row.id),
		type: scalarString(row.type),
		threadId: nullableString(row.thread_id),
		turnId: nullableString(row.turn_id),
		payload: readJson<Record<string, unknown>>(row.payload_json, {}),
		createdAt: scalarString(row.created_at),
	};
}

export class Store {
	private transactionDepth = 0;

	constructor(private readonly db: DatabaseSync) {}

	static open(filePath: string) {
		if (filePath !== ":memory:") {
			mkdirSync(dirname(filePath), { recursive: true });
		}
		const db = new DatabaseSync(filePath);
		const store = new Store(db);
		try {
			store.configure();
			store.initializeSchema();
			return store;
		} catch (error) {
			db.close();
			throw error;
		}
	}

	close() {
		this.db.close();
	}

	configure() {
		this.db.exec("PRAGMA foreign_keys = ON");
		this.db.exec("PRAGMA busy_timeout = 5000");
		this.db.exec("PRAGMA journal_mode = WAL");
		this.db.exec("PRAGMA synchronous = NORMAL");
		this.db.exec("PRAGMA temp_store = MEMORY");
	}

	transaction<T>(body: () => T): T {
		if (this.transactionDepth > 0) {
			return body();
		}
		this.transactionDepth += 1;
		let started = false;
		try {
			this.db.exec("BEGIN IMMEDIATE");
			started = true;
			const result = body();
			this.db.exec("COMMIT");
			return result;
		} catch (error) {
			if (started) {
				this.db.exec("ROLLBACK");
			}
			throw error;
		} finally {
			this.transactionDepth -= 1;
		}
	}

	initializeSchema() {
		const databaseVersion = this.readDatabaseVersion();
		if (databaseVersion !== null) {
			this.requireDatabaseVersion(databaseVersion);
			return;
		}

		if (this.hasUserTables()) {
			throw new Error(
				`Database version is missing; expected "${currentDatabaseVersion}"`,
			);
		}

		this.db.exec("BEGIN");
		try {
			this.createCurrentSchema();
			this.writeDatabaseVersion();
			this.db.exec("COMMIT");
		} catch (error) {
			this.db.exec("ROLLBACK");
			throw error;
		}
	}

	private createCurrentSchema() {
		this.db.exec(`
      CREATE TABLE ${metadataTable} (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE hosts (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        runtime TEXT NOT NULL,
        version TEXT,
        default_cwd TEXT,
        last_seen_at TEXT NOT NULL
      );

      CREATE TABLE threads (
        id TEXT PRIMARY KEY,
        -- TODO: migrate this storage naming once the app-server thread
        -- lineage model settles. session_id stores Codex's shared fork-tree id,
        -- while user-facing code now treats thread as the primary concept.
        session_id TEXT NOT NULL,
        forked_from_id TEXT REFERENCES threads(id) ON DELETE SET NULL,
        name TEXT NOT NULL,
        preview TEXT NOT NULL,
        cwd TEXT NOT NULL,
        model TEXT,
        status TEXT NOT NULL CHECK (status IN ('idle', 'active', 'not_loaded', 'system_error')),
        active_turn_id TEXT,
        last_turn_status TEXT CHECK (last_turn_status IS NULL OR last_turn_status IN ('in_progress', 'completed', 'interrupted', 'failed')),
        goal_objective TEXT,
        goal_status TEXT CHECK (goal_status IS NULL OR goal_status IN ('in_progress', 'paused', 'blocked', 'usage_limited', 'budget_limited', 'complete', 'cleared')),
        goal_token_budget INTEGER,
        tokens_used INTEGER NOT NULL DEFAULT 0,
        tag_score INTEGER CHECK (tag_score IS NULL OR tag_score IN (1, 2, 3)),
        archived_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE turns (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
        status TEXT NOT NULL CHECK (status IN ('in_progress', 'completed', 'interrupted', 'failed')),
        prompt TEXT NOT NULL,
        started_at TEXT NOT NULL,
        completed_at TEXT,
        duration_ms INTEGER
      );

      CREATE TABLE items (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
        turn_id TEXT REFERENCES turns(id) ON DELETE CASCADE,
        type TEXT NOT NULL CHECK (type IN ('user', 'agent', 'plan', 'command', 'file', 'system')),
        text TEXT NOT NULL,
        data_json TEXT NOT NULL CHECK (json_valid(data_json)),
        text_length INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL,
        thread_id TEXT REFERENCES threads(id) ON DELETE CASCADE,
        turn_id TEXT REFERENCES turns(id) ON DELETE CASCADE,
        is_summary INTEGER NOT NULL CHECK (is_summary IN (0, 1)),
        payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
        payload_bytes INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_threads_active_updated_id ON threads(archived_at, updated_at DESC, id DESC);
      CREATE INDEX IF NOT EXISTS idx_threads_cwd_active_updated_id ON threads(cwd, archived_at, updated_at DESC, id DESC);
      CREATE INDEX IF NOT EXISTS idx_threads_session_id ON threads(session_id);
      CREATE INDEX IF NOT EXISTS idx_threads_status_updated_id ON threads(status, updated_at DESC, id DESC);
      CREATE INDEX IF NOT EXISTS idx_threads_forked_from_id ON threads(forked_from_id) WHERE forked_from_id IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_turns_thread_started_id ON turns(thread_id, started_at, id);
      CREATE INDEX IF NOT EXISTS idx_items_thread_created_id ON items(thread_id, created_at, id);
      CREATE INDEX IF NOT EXISTS idx_events_thread_id ON events(thread_id, id);
      CREATE INDEX IF NOT EXISTS idx_events_summary_id ON events(is_summary, id);
    `);
	}

	private readDatabaseVersion() {
		if (!this.tableExists(metadataTable)) {
			return null;
		}
		const row = this.db
			.prepare(`SELECT value FROM ${metadataTable} WHERE key = ?`)
			.get(versionKey) as Row | undefined;
		return row ? scalarString(row.value) : null;
	}

	private requireDatabaseVersion(databaseVersion: string) {
		if (databaseVersion !== currentDatabaseVersion) {
			throw new Error(
				`Unsupported database version "${databaseVersion}"; expected "${currentDatabaseVersion}"`,
			);
		}
	}

	private writeDatabaseVersion() {
		this.db
			.prepare(`INSERT INTO ${metadataTable} (key, value) VALUES (?, ?)`)
			.run(versionKey, currentDatabaseVersion);
	}

	private tableExists(table: string) {
		const row = this.db
			.prepare(
				"SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
			)
			.get(table) as Row | undefined;
		return Boolean(row);
	}

	private hasUserTables() {
		const row = this.db
			.prepare(
				"SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
			)
			.get() as Row | undefined;
		return row ? scalarNumber(row.count) > 0 : false;
	}

	upsertHost(input: {
		id: string;
		name: string;
		runtime: string;
		version?: string | null;
		defaultCwd?: string | null;
	}) {
		const seen = nowIso();
		this.db
			.prepare(
				`
          INSERT INTO hosts (id, name, runtime, version, default_cwd, last_seen_at)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            runtime = excluded.runtime,
            version = excluded.version,
            default_cwd = excluded.default_cwd,
            last_seen_at = excluded.last_seen_at
        `,
			)
			.run(
				input.id,
				input.name,
				input.runtime,
				input.version ?? null,
				input.defaultCwd ?? null,
				seen,
			);
	}

	getDefaultCwd() {
		const row = this.db
			.prepare("SELECT default_cwd FROM hosts WHERE id = ?")
			.get("local") as Row | undefined;
		return row ? nullableString(row.default_cwd) : null;
	}

	createThread(thread: ControlThread) {
		this.db
			.prepare(
				`
          INSERT INTO threads (
            id, session_id, forked_from_id, name, preview, cwd, model,
            status, active_turn_id, last_turn_status, goal_objective, goal_status, goal_token_budget,
            tokens_used, tag_score, archived_at, created_at, updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
			)
			.run(
				thread.id,
				thread.sessionId,
				thread.forkedFromId,
				thread.name,
				thread.preview,
				thread.cwd,
				thread.model,
				thread.status,
				thread.activeTurnId,
				thread.lastTurnStatus,
				thread.goalObjective,
				thread.goalStatus,
				thread.goalTokenBudget,
				thread.tokensUsed,
				thread.tagScore,
				thread.archivedAt,
				thread.createdAt,
				thread.updatedAt,
			);
		return this.getThread(thread.id);
	}

	updateThread(
		id: string,
		updates: Partial<
			Pick<
				ControlThread,
				| "status"
				| "activeTurnId"
				| "lastTurnStatus"
				| "goalObjective"
				| "goalStatus"
				| "goalTokenBudget"
				| "tokensUsed"
				| "name"
				| "preview"
			>
		>,
		options: ThreadUpdateOptions = {},
	) {
		const existing = this.getThread(id);
		if (!existing) {
			throw new Error(`Thread ${id} does not exist`);
		}
		const updatedAt =
			options.updatedAt ??
			(options.preserveUpdatedAt ? existing.updatedAt : nowIso());
		const next = { ...existing, ...updates, updatedAt };
		this.db
			.prepare(
				`
          UPDATE threads SET
            name = ?,
            preview = ?,
            status = ?,
            active_turn_id = ?,
            last_turn_status = ?,
            goal_objective = ?,
            goal_status = ?,
            goal_token_budget = ?,
            tokens_used = ?,
            updated_at = ?
          WHERE id = ?
        `,
			)
			.run(
				next.name,
				next.preview,
				next.status,
				next.activeTurnId,
				next.lastTurnStatus,
				next.goalObjective,
				next.goalStatus,
				next.goalTokenBudget,
				next.tokensUsed,
				next.updatedAt,
				id,
			);
		return this.getThread(id);
	}

	updateThreadTagScore(id: string, tagScore: ThreadTagScore | null) {
		const result = this.db
			.prepare("UPDATE threads SET tag_score = ? WHERE id = ?")
			.run(tagScore, id);
		if (result.changes === 0) {
			throw new Error(`Thread ${id} does not exist`);
		}
		return this.getThread(id);
	}

	getThread(id: string) {
		const row = this.db.prepare("SELECT * FROM threads WHERE id = ?").get(id);
		return row ? threadFromRow(row as Row) : null;
	}

	archiveThread(id: string, archivedAt = nowIso()): ArchiveThreadResult {
		const existing = this.getThread(id);
		if (!existing) {
			throw new Error(`Thread ${id} does not exist`);
		}
		const row = this.db
			.prepare("SELECT archived_at FROM threads WHERE id = ?")
			.get(id) as Row | undefined;
		const existingArchivedAt = nullableString(row?.archived_at);
		if (existingArchivedAt) {
			return {
				thread: existing,
				archivedAt: existingArchivedAt,
				changed: false,
			};
		}
		this.db
			.prepare(
				`
          UPDATE threads SET
            status = ?,
            active_turn_id = ?,
            archived_at = ?,
            updated_at = ?
          WHERE id = ?
        `,
			)
			.run("not_loaded", null, archivedAt, archivedAt, id);
		const thread = this.getThread(id);
		if (!thread) {
			throw new Error(`Thread ${id} does not exist`);
		}
		return {
			thread,
			archivedAt,
			changed: true,
		};
	}

	countThreads(options: Pick<ThreadListOptions, "archived"> = {}) {
		const archived = options.archived ?? false;
		const row = this.db
			.prepare(
				`SELECT COUNT(*) AS count FROM threads WHERE archived_at IS ${
					archived ? "NOT NULL" : "NULL"
				}`,
			)
			.get() as Row | undefined;
		return row ? scalarNumber(row.count) : 0;
	}

	listThreads(options: ThreadListOptions = {}) {
		const limit = options.limit ?? null;
		const cursor = options.cursor ?? null;
		const archived = options.archived ?? false;
		const conditions = [`archived_at IS ${archived ? "NOT NULL" : "NULL"}`];
		const params: Array<string | number> = [];
		if (cursor) {
			conditions.push("(updated_at < ? OR (updated_at = ? AND id < ?))");
			params.push(cursor.updatedAt, cursor.updatedAt, cursor.id);
		}
		const where = `WHERE ${conditions.join(" AND ")}`;
		if (limit !== null) {
			return this.db
				.prepare(
					`SELECT * FROM threads ${where} ORDER BY updated_at DESC, id DESC LIMIT ?`,
				)
				.all(...params, limit)
				.map((row) => threadFromRow(row as Row));
		}
		return this.db
			.prepare(
				`SELECT * FROM threads ${where} ORDER BY updated_at DESC, id DESC`,
			)
			.all(...params)
			.map((row) => threadFromRow(row as Row));
	}

	getThreadDetail(id: string): ThreadDetail | null {
		const latestEventId = this.getLatestEventIdForThread(id);
		const thread = this.getThread(id);
		if (!thread) {
			return null;
		}
		const itemsPage = this.listThreadItemsPage(id, { direction: "before" });
		return {
			...thread,
			turns: this.listTurns(id),
			items: itemsPage.items,
			itemTotalCount: itemsPage.totalCount,
			itemPageSize: itemsPage.items.length,
			itemPageDirection: itemsPage.direction,
			itemNextCursor: itemsPage.nextCursor,
			itemHasMore: itemsPage.hasMore,
			latestEventId,
		};
	}

	createTurn(turn: Turn) {
		this.db
			.prepare(
				`
          INSERT INTO turns (id, thread_id, status, prompt, started_at, completed_at, duration_ms)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `,
			)
			.run(
				turn.id,
				turn.threadId,
				turn.status,
				turn.prompt,
				turn.startedAt,
				turn.completedAt,
				turn.durationMs,
			);
		return this.getTurn(turn.id);
	}

	updateTurn(
		id: string,
		updates: Partial<
			Pick<Turn, "status" | "prompt" | "completedAt" | "durationMs">
		>,
	) {
		const existing = this.getTurn(id);
		if (!existing) {
			throw new Error(`Turn ${id} does not exist`);
		}
		const next = { ...existing, ...updates };
		this.db
			.prepare(
				"UPDATE turns SET status = ?, prompt = ?, completed_at = ?, duration_ms = ? WHERE id = ?",
			)
			.run(next.status, next.prompt, next.completedAt, next.durationMs, id);
		return this.getTurn(id);
	}

	getTurn(id: string) {
		const row = this.db.prepare("SELECT * FROM turns WHERE id = ?").get(id);
		return row ? turnFromRow(row as Row) : null;
	}

	listTurns(threadId: string) {
		return this.db
			.prepare(
				"SELECT * FROM turns WHERE thread_id = ? ORDER BY started_at ASC, id ASC",
			)
			.all(threadId)
			.map((row) => turnFromRow(row as Row));
	}

	createItem(item: ThreadItem) {
		const stored = this.writeItem(item);
		if (!stored) {
			throw new Error(`Failed to create item ${item.id}`);
		}
		return stored;
	}

	upsertItem(item: ThreadItem) {
		return this.writeItem(item);
	}

	private writeItem(item: ThreadItem) {
		const dataJson = jsonText(item.data);
		this.db
			.prepare(
				`
          INSERT INTO items (id, thread_id, turn_id, type, text, data_json, text_length, updated_at, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            thread_id = excluded.thread_id,
            turn_id = excluded.turn_id,
            type = excluded.type,
            text = excluded.text,
            data_json = excluded.data_json,
            text_length = excluded.text_length,
            updated_at = excluded.updated_at
        `,
			)
			.run(
				item.id,
				item.threadId,
				item.turnId,
				item.type,
				item.text,
				dataJson,
				textLength(item.text),
				item.createdAt,
				item.createdAt,
			);
		return this.getItem(item.id);
	}

	getItem(id: string) {
		const row = this.db.prepare("SELECT * FROM items WHERE id = ?").get(id);
		return row ? itemFromRow(row as Row) : null;
	}

	appendItemText(id: string, delta: string) {
		const result = this.db
			.prepare(
				"UPDATE items SET text = text || ?, text_length = length(text || ?), updated_at = ? WHERE id = ?",
			)
			.run(delta, delta, nowIso(), id);
		if (result.changes === 0) {
			return null;
		}
		const item = this.db.prepare("SELECT * FROM items WHERE id = ?").get(id);
		return item ? itemFromRow(item as Row) : null;
	}

	countItems(threadId: string) {
		const row = this.db
			.prepare("SELECT COUNT(*) AS count FROM items WHERE thread_id = ?")
			.get(threadId) as Row | undefined;
		return row ? scalarNumber(row.count) : 0;
	}

	listItems(threadId: string, options: ThreadItemListOptions = {}) {
		const limit = options.limit ?? null;
		const cursor = options.cursor ?? null;
		const direction = options.direction ?? "after";
		const conditions = ["thread_id = ?"];
		const params: Array<string | number> = [threadId];
		if (cursor) {
			conditions.push(
				direction === "before"
					? "(created_at < ? OR (created_at = ? AND id < ?))"
					: "(created_at > ? OR (created_at = ? AND id > ?))",
			);
			params.push(cursor.createdAt, cursor.createdAt, cursor.id);
		}
		const where = `WHERE ${conditions.join(" AND ")}`;
		const order =
			direction === "before"
				? "ORDER BY created_at DESC, id DESC"
				: "ORDER BY created_at ASC, id ASC";
		if (limit !== null) {
			return this.db
				.prepare(`SELECT * FROM items ${where} ${order} LIMIT ?`)
				.all(...params, limit)
				.map((row) => itemFromRow(row as Row));
		}
		return this.db
			.prepare(`SELECT * FROM items ${where} ${order}`)
			.all(...params)
			.map((row) => itemFromRow(row as Row));
	}

	listThreadItemsPage(
		threadId: string,
		options: ThreadItemListOptions = {},
	): ThreadItemsPage {
		const limit = normalizeThreadItemPageLimit(options.limit);
		const cursor = options.cursor ?? null;
		const direction = options.direction ?? "after";
		const pageItems = this.listItems(threadId, {
			limit: limit + 1,
			cursor,
			direction,
		});
		const hasMore = pageItems.length > limit;
		const limitedItems = hasMore ? pageItems.slice(0, limit) : pageItems;
		const items =
			direction === "before" ? [...limitedItems].reverse() : limitedItems;
		return {
			threadId,
			items,
			limit,
			direction,
			cursor,
			nextCursor: pageCursorFromItems(
				items,
				hasMore,
				direction === "before" ? "first" : "last",
			),
			hasMore,
			totalCount: this.countItems(threadId),
		};
	}

	appendEvent(input: Omit<CozEvent, "id">) {
		const type = input.type;
		const payloadJson = jsonText(input.payload);
		const result = this.db
			.prepare(
				"INSERT INTO events (type, thread_id, turn_id, is_summary, payload_json, payload_bytes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
			)
			.run(
				type,
				input.threadId,
				input.turnId,
				eventSummaryValue(type),
				payloadJson,
				byteLength(payloadJson),
				input.createdAt,
			);
		const id = Number(result.lastInsertRowid);
		const row = this.db.prepare("SELECT * FROM events WHERE id = ?").get(id);
		if (!row) {
			throw new Error("Failed to append event");
		}
		return eventFromRow(row as Row);
	}

	getLatestEventId() {
		const row = this.db
			.prepare("SELECT COALESCE(MAX(id), 0) AS latest_event_id FROM events")
			.get() as Row | undefined;
		return row ? scalarNumber(row.latest_event_id) : 0;
	}

	getLatestEventIdForThread(threadId: string) {
		const row = this.db
			.prepare(
				"SELECT COALESCE(MAX(id), 0) AS latest_event_id FROM events WHERE thread_id = ?",
			)
			.get(threadId) as Row | undefined;
		return row ? scalarNumber(row.latest_event_id) : 0;
	}

	getLatestEventIdForReplay(options: EventReplayOptions = {}) {
		const conditions: string[] = [];
		const params: Array<string | number> = [];
		if (options.threadId) {
			conditions.push("thread_id = ?");
			params.push(options.threadId);
		}
		if (options.summaryOnly) {
			conditions.push("is_summary = 1");
		}
		const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
		const row = this.db
			.prepare(
				`SELECT COALESCE(MAX(id), 0) AS latest_event_id FROM events ${where}`,
			)
			.get(...params) as Row | undefined;
		return row ? scalarNumber(row.latest_event_id) : 0;
	}

	listEvents(afterId = 0, options: EventReplayOptions = {}) {
		const conditions = ["id > ?"];
		const params: Array<string | number> = [afterId];

		if (options.threadId) {
			conditions.push("thread_id = ?");
			params.push(options.threadId);
		}

		if (options.summaryOnly) {
			conditions.push("is_summary = 1");
		}

		const limit = options.limit ?? null;
		const rows = limit
			? this.db
					.prepare(
						`SELECT * FROM events WHERE ${conditions.join(" AND ")} ORDER BY id ASC LIMIT ?`,
					)
					.all(...params, limit)
			: this.db
					.prepare(
						`SELECT * FROM events WHERE ${conditions.join(" AND ")} ORDER BY id ASC`,
					)
					.all(...params);
		const events = rows
			.map((row) => eventFromRow(row as Row))
			.filter(
				(event) => !options.summaryOnly || isSummaryEventType(event.type),
			);
		const maxPayloadBytes = options.maxPayloadBytes ?? null;
		if (maxPayloadBytes === null) {
			return events;
		}
		const bounded: CozEvent[] = [];
		let totalBytes = 0;
		for (const event of events) {
			const payloadBytes = byteLength(jsonText(event.payload));
			if (bounded.length > 0 && totalBytes + payloadBytes > maxPayloadBytes) {
				break;
			}
			bounded.push(event);
			totalBytes += payloadBytes;
			if (totalBytes >= maxPayloadBytes) {
				break;
			}
		}
		return bounded;
	}
}
