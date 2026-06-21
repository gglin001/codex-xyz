import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  type ControlThread,
  type GoalStatus,
  type ItemType,
  isSummaryEventType,
  nowIso,
  summaryEventTypes,
  type ThreadRuntimeStatus,
  type ThreadDetail,
  type ThreadItem,
  type Turn,
  type TurnStatus,
  type XyzEvent
} from "./domain.js";

type Row = Record<string, unknown>;

export const currentDatabaseVersion = "v1";

const databaseMetadataTable = "database_metadata";
const databaseVersionKey = "database_version";

type EventReplayOptions = {
  threadId?: string | null;
  summaryOnly?: boolean;
};

type ThreadListOptions = {
  limit?: number | null;
  offset?: number | null;
};

type ThreadUpdateOptions = {
  updatedAt?: string | null;
  preserveUpdatedAt?: boolean;
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
  if (status === "idle" || status === "active" || status === "not_loaded" || status === "system_error") {
    return status;
  }
  throw new Error(`Invalid thread status "${status}"`);
}

function storedTurnStatus(value: unknown): TurnStatus {
  const status = scalarString(value);
  if (status === "in_progress" || status === "completed" || status === "interrupted" || status === "failed") {
    return status;
  }
  throw new Error(`Invalid turn status "${status}"`);
}

function threadFromRow(row: Row): ControlThread {
  return {
    id: scalarString(row.id),
    sessionId: scalarString(row.session_id),
    forkedFromId: nullableString(row.forked_from_id),
    title: scalarString(row.title),
    preview: scalarString(row.preview),
    cwd: scalarString(row.cwd),
    model: nullableString(row.model),
    status: storedThreadStatus(row.status),
    activeTurnId: nullableString(row.active_turn_id),
    lastTurnStatus: row.last_turn_status ? storedTurnStatus(row.last_turn_status) : null,
    goalObjective: nullableString(row.goal_objective),
    goalStatus: nullableString(row.goal_status) as GoalStatus | null,
    goalTokenBudget: typeof row.goal_token_budget === "number" ? row.goal_token_budget : null,
    tokensUsed: scalarNumber(row.tokens_used),
    createdAt: scalarString(row.created_at),
    updatedAt: scalarString(row.updated_at)
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
    durationMs: typeof row.duration_ms === "number" ? row.duration_ms : null
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
    createdAt: scalarString(row.created_at)
  };
}

function eventFromRow(row: Row): XyzEvent {
  return {
    id: scalarNumber(row.id),
    type: scalarString(row.type),
    threadId: nullableString(row.thread_id),
    turnId: nullableString(row.turn_id),
    payload: readJson<Record<string, unknown>>(row.payload_json, {}),
    createdAt: scalarString(row.created_at)
  };
}

export class Store {
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
    this.db.exec("PRAGMA journal_mode = WAL");
  }

  initializeSchema() {
    const databaseVersion = this.readDatabaseVersion();
    if (databaseVersion !== null) {
      this.requireDatabaseVersion(databaseVersion);
      return;
    }

    if (this.hasUserTables()) {
      throw new Error(`Database version is missing; expected "${currentDatabaseVersion}"`);
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
      CREATE TABLE ${databaseMetadataTable} (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE hosts (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        adapter TEXT NOT NULL,
        version TEXT,
        default_cwd TEXT,
        last_seen_at TEXT NOT NULL
      );

      CREATE TABLE threads (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        forked_from_id TEXT,
        title TEXT NOT NULL,
        preview TEXT NOT NULL,
        cwd TEXT NOT NULL,
        model TEXT,
        status TEXT NOT NULL,
        active_turn_id TEXT,
        last_turn_status TEXT,
        goal_objective TEXT,
        goal_status TEXT,
        goal_token_budget INTEGER,
        tokens_used INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE turns (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
        status TEXT NOT NULL,
        prompt TEXT NOT NULL,
        started_at TEXT NOT NULL,
        completed_at TEXT,
        duration_ms INTEGER
      );

      CREATE TABLE items (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
        turn_id TEXT REFERENCES turns(id) ON DELETE CASCADE,
        type TEXT NOT NULL,
        text TEXT NOT NULL,
        data_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL,
        thread_id TEXT,
        turn_id TEXT,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_threads_updated ON threads(updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_turns_thread ON turns(thread_id);
      CREATE INDEX IF NOT EXISTS idx_turns_thread_started ON turns(thread_id, started_at);
      CREATE INDEX IF NOT EXISTS idx_items_thread ON items(thread_id);
      CREATE INDEX IF NOT EXISTS idx_items_thread_created ON items(thread_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_events_thread ON events(thread_id);
      CREATE INDEX IF NOT EXISTS idx_events_thread_id ON events(thread_id, id);
      CREATE INDEX IF NOT EXISTS idx_events_type_id ON events(type, id);
    `);
  }

  private readDatabaseVersion() {
    if (!this.tableExists(databaseMetadataTable)) {
      return null;
    }
    const row = this.db
      .prepare(`SELECT value FROM ${databaseMetadataTable} WHERE key = ?`)
      .get(databaseVersionKey) as Row | undefined;
    return row ? scalarString(row.value) : null;
  }

  private requireDatabaseVersion(databaseVersion: string) {
    if (databaseVersion !== currentDatabaseVersion) {
      throw new Error(`Unsupported database version "${databaseVersion}"; expected "${currentDatabaseVersion}"`);
    }
  }

  private writeDatabaseVersion() {
    this.db
      .prepare(`INSERT INTO ${databaseMetadataTable} (key, value) VALUES (?, ?)`)
      .run(databaseVersionKey, currentDatabaseVersion);
  }

  private tableExists(table: string) {
    const row = this.db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(table) as Row | undefined;
    return Boolean(row);
  }

  private hasUserTables() {
    const row = this.db
      .prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
      .get() as Row | undefined;
    return row ? scalarNumber(row.count) > 0 : false;
  }

  upsertHost(input: { id: string; name: string; adapter: string; version?: string | null; defaultCwd?: string | null }) {
    const seen = nowIso();
    this.db
      .prepare(
        `
          INSERT INTO hosts (id, name, adapter, version, default_cwd, last_seen_at)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            adapter = excluded.adapter,
            version = excluded.version,
            default_cwd = excluded.default_cwd,
            last_seen_at = excluded.last_seen_at
        `
      )
      .run(input.id, input.name, input.adapter, input.version ?? null, input.defaultCwd ?? null, seen);
  }

  getDefaultCwd() {
    const row = this.db.prepare("SELECT default_cwd FROM hosts WHERE id = ?").get("local") as Row | undefined;
    return row ? nullableString(row.default_cwd) : null;
  }

  createThread(thread: ControlThread) {
    this.db
      .prepare(
        `
          INSERT INTO threads (
            id, session_id, forked_from_id, title, preview, cwd, model,
            status, active_turn_id, last_turn_status, goal_objective, goal_status, goal_token_budget,
            tokens_used, created_at, updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
      )
      .run(
        thread.id,
        thread.sessionId,
        thread.forkedFromId,
        thread.title,
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
        thread.createdAt,
        thread.updatedAt
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
        | "title"
        | "preview"
      >
    >,
    options: ThreadUpdateOptions = {}
  ) {
    const existing = this.getThread(id);
    if (!existing) {
      throw new Error(`Thread ${id} does not exist`);
    }
    const updatedAt = options.updatedAt ?? (options.preserveUpdatedAt ? existing.updatedAt : nowIso());
    const next = { ...existing, ...updates, updatedAt };
    this.db
      .prepare(
        `
          UPDATE threads SET
            title = ?,
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
        `
      )
      .run(
        next.title,
        next.preview,
        next.status,
        next.activeTurnId,
        next.lastTurnStatus,
        next.goalObjective,
        next.goalStatus,
        next.goalTokenBudget,
        next.tokensUsed,
        next.updatedAt,
        id
      );
    return this.getThread(id);
  }

  getThread(id: string) {
    const row = this.db.prepare("SELECT * FROM threads WHERE id = ?").get(id);
    return row ? threadFromRow(row as Row) : null;
  }

  countThreads() {
    const row = this.db.prepare("SELECT COUNT(*) AS count FROM threads").get() as Row | undefined;
    return row ? scalarNumber(row.count) : 0;
  }

  listThreads(options: ThreadListOptions = {}) {
    const limit = options.limit ?? null;
    const offset = options.offset ?? null;
    if (limit !== null) {
      return this.db
        .prepare("SELECT * FROM threads ORDER BY updated_at DESC, id DESC LIMIT ? OFFSET ?")
        .all(limit, offset ?? 0)
        .map((row) => threadFromRow(row as Row));
    }
    return this.db
      .prepare("SELECT * FROM threads ORDER BY updated_at DESC, id DESC")
      .all()
      .map((row) => threadFromRow(row as Row));
  }

  getThreadDetail(id: string): ThreadDetail | null {
    const latestEventId = this.getLatestEventIdForThread(id);
    const thread = this.getThread(id);
    if (!thread) {
      return null;
    }
    return {
      ...thread,
      turns: this.listTurns(id),
      items: this.listItems(id),
      latestEventId
    };
  }

  createTurn(turn: Turn) {
    this.db
      .prepare(
        `
          INSERT INTO turns (id, thread_id, status, prompt, started_at, completed_at, duration_ms)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `
      )
      .run(turn.id, turn.threadId, turn.status, turn.prompt, turn.startedAt, turn.completedAt, turn.durationMs);
    return this.getTurn(turn.id);
  }

  updateTurn(id: string, updates: Partial<Pick<Turn, "status" | "prompt" | "completedAt" | "durationMs">>) {
    const existing = this.getTurn(id);
    if (!existing) {
      throw new Error(`Turn ${id} does not exist`);
    }
    const next = { ...existing, ...updates };
    this.db
      .prepare("UPDATE turns SET status = ?, prompt = ?, completed_at = ?, duration_ms = ? WHERE id = ?")
      .run(next.status, next.prompt, next.completedAt, next.durationMs, id);
    return this.getTurn(id);
  }

  getTurn(id: string) {
    const row = this.db.prepare("SELECT * FROM turns WHERE id = ?").get(id);
    return row ? turnFromRow(row as Row) : null;
  }

  listTurns(threadId: string) {
    return this.db
      .prepare("SELECT * FROM turns WHERE thread_id = ? ORDER BY started_at ASC")
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
    this.db
      .prepare(
        `
          INSERT INTO items (id, thread_id, turn_id, type, text, data_json, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            thread_id = excluded.thread_id,
            turn_id = excluded.turn_id,
            type = excluded.type,
            text = excluded.text,
            data_json = excluded.data_json
        `
      )
      .run(item.id, item.threadId, item.turnId, item.type, item.text, JSON.stringify(item.data), item.createdAt);
    return this.getItem(item.id);
  }

  getItem(id: string) {
    const row = this.db.prepare("SELECT * FROM items WHERE id = ?").get(id);
    return row ? itemFromRow(row as Row) : null;
  }

  appendItemText(id: string, delta: string) {
    const row = this.db.prepare("SELECT text FROM items WHERE id = ?").get(id) as Row | undefined;
    if (!row) {
      return null;
    }
    const text = `${scalarString(row.text)}${delta}`;
    this.db.prepare("UPDATE items SET text = ? WHERE id = ?").run(text, id);
    const item = this.db.prepare("SELECT * FROM items WHERE id = ?").get(id);
    return item ? itemFromRow(item as Row) : null;
  }

  listItems(threadId: string) {
    return this.db
      .prepare("SELECT * FROM items WHERE thread_id = ? ORDER BY created_at ASC")
      .all(threadId)
      .map((row) => itemFromRow(row as Row));
  }

  appendEvent(input: Omit<XyzEvent, "id">) {
    const result = this.db
      .prepare("INSERT INTO events (type, thread_id, turn_id, payload_json, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(input.type, input.threadId, input.turnId, JSON.stringify(input.payload), input.createdAt);
    const id = Number(result.lastInsertRowid);
    const row = this.db.prepare("SELECT * FROM events WHERE id = ?").get(id);
    if (!row) {
      throw new Error("Failed to append event");
    }
    return eventFromRow(row as Row);
  }

  getLatestEventId() {
    const row = this.db.prepare("SELECT COALESCE(MAX(id), 0) AS latest_event_id FROM events").get() as Row | undefined;
    return row ? scalarNumber(row.latest_event_id) : 0;
  }

  getLatestEventIdForThread(threadId: string) {
    const row = this.db
      .prepare("SELECT COALESCE(MAX(id), 0) AS latest_event_id FROM events WHERE thread_id = ?")
      .get(threadId) as Row | undefined;
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
      conditions.push(`type IN (${summaryEventTypes.map(() => "?").join(", ")})`);
      params.push(...summaryEventTypes);
    }

    return this.db
      .prepare(`SELECT * FROM events WHERE ${conditions.join(" AND ")} ORDER BY id ASC`)
      .all(...params)
      .map((row) => eventFromRow(row as Row))
      .filter((event) => !options.summaryOnly || isSummaryEventType(event.type));
  }
}
