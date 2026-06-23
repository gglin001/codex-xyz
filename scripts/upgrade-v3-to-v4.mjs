#!/usr/bin/env node
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const fromVersion = "v3";
const toVersion = "v4";
const metadataTable = "database_metadata";
const databaseVersionKey = "database_version";
const defaultDatabasePath = ".coz/coz.sqlite";

const summaryEventTypes = [
	"turn.started",
	"turn.status",
	"turn.steered",
	"turn.interrupt.requested",
	"thread.started",
	"thread.resumed",
	"thread.status",
	"thread.runtime_lost",
	"thread.forked",
	"thread.archived",
	"thread.renamed",
	"thread.goal.updated",
	"thread.goal.cleared",
	"thread.token_usage",
];

const retainedEventTypes = [
	"item.created",
	"item.updated",
	...summaryEventTypes,
];

const databasePath = resolve(process.argv[2] ?? defaultDatabasePath);

function usage() {
	console.error(
		`Usage: node scripts/upgrade-v3-to-v4.mjs [${defaultDatabasePath}]`,
	);
}

function fail(message) {
	console.error(message);
	process.exitCode = 1;
}

function tableExists(db, table) {
	const row = db
		.prepare("SELECT name FROM sqlite_master WHERE type = ? AND name = ?")
		.get("table", table);
	return Boolean(row);
}

function readDatabaseVersion(db) {
	if (!tableExists(db, metadataTable)) {
		return null;
	}
	const row = db
		.prepare(`SELECT value FROM ${metadataTable} WHERE key = ?`)
		.get(databaseVersionKey);
	return typeof row?.value === "string" ? row.value : null;
}

function sqlString(value) {
	return `'${value.replaceAll("'", "''")}'`;
}

function sqlStringList(values) {
	return values.map(sqlString).join(", ");
}

function jsonText(value) {
	return JSON.stringify(value);
}

function payloadBytes(payloadJson) {
	return Buffer.byteLength(payloadJson, "utf8");
}

function validPayloadJson(payloadJson) {
	try {
		JSON.parse(payloadJson);
		return payloadJson;
	} catch {
		return "{}";
	}
}

function compactItemEventPayload(payloadJson) {
	let payload;
	try {
		payload = JSON.parse(payloadJson);
	} catch {
		return "{}";
	}
	const item = payload?.item;
	if (!item || typeof item !== "object") {
		return "{}";
	}
	return jsonText({
		itemRef: {
			id: typeof item.id === "string" ? item.id : null,
			threadId: typeof item.threadId === "string" ? item.threadId : null,
			turnId: typeof item.turnId === "string" ? item.turnId : null,
			type: typeof item.type === "string" ? item.type : null,
			textLength: typeof item.text === "string" ? item.text.length : 0,
			createdAt: typeof item.createdAt === "string" ? item.createdAt : null,
		},
	});
}

function createV4Tables(db) {
	db.exec(`
    CREATE TABLE hosts_v4 (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      adapter TEXT NOT NULL,
      version TEXT,
      default_cwd TEXT,
      last_seen_at TEXT NOT NULL
    );

    CREATE TABLE threads_v4 (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      forked_from_id TEXT REFERENCES threads_v4(id) ON DELETE SET NULL,
      title TEXT NOT NULL,
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
      archived_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE turns_v4 (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL REFERENCES threads_v4(id) ON DELETE CASCADE,
      status TEXT NOT NULL CHECK (status IN ('in_progress', 'completed', 'interrupted', 'failed')),
      prompt TEXT NOT NULL,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      duration_ms INTEGER
    );

    CREATE TABLE items_v4 (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL REFERENCES threads_v4(id) ON DELETE CASCADE,
      turn_id TEXT REFERENCES turns_v4(id) ON DELETE CASCADE,
      type TEXT NOT NULL CHECK (type IN ('user', 'agent', 'plan', 'command', 'file', 'system')),
      text TEXT NOT NULL,
      data_json TEXT NOT NULL CHECK (json_valid(data_json)),
      text_length INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE events_v4 (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      thread_id TEXT REFERENCES threads_v4(id) ON DELETE CASCADE,
      turn_id TEXT REFERENCES turns_v4(id) ON DELETE CASCADE,
      is_summary INTEGER NOT NULL CHECK (is_summary IN (0, 1)),
      payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
      payload_bytes INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
  `);
}

function copyRelationalData(db) {
	db.exec(`
    INSERT INTO hosts_v4 (id, name, adapter, version, default_cwd, last_seen_at)
    SELECT id, name, adapter, version, default_cwd, last_seen_at FROM hosts;

    INSERT INTO threads_v4 (
      id, session_id, forked_from_id, title, preview, cwd, model, status,
      active_turn_id, last_turn_status, goal_objective, goal_status,
      goal_token_budget, tokens_used, archived_at, created_at, updated_at
    )
    SELECT
      id, session_id, forked_from_id, title, preview, cwd, model, status,
      active_turn_id, last_turn_status, goal_objective, goal_status,
      goal_token_budget, tokens_used, archived_at, created_at, updated_at
    FROM threads;

    INSERT INTO turns_v4 (
      id, thread_id, status, prompt, started_at, completed_at, duration_ms
    )
    SELECT id, thread_id, status, prompt, started_at, completed_at, duration_ms
    FROM turns;

    INSERT INTO items_v4 (
      id, thread_id, turn_id, type, text, data_json, text_length, updated_at, created_at
    )
    SELECT
      id,
      thread_id,
      turn_id,
      type,
      text,
      CASE WHEN json_valid(data_json) THEN data_json ELSE '{}' END,
      length(text),
      created_at,
      created_at
    FROM items;
  `);
}

function copyEvents(db) {
	const summaryTypes = sqlStringList(summaryEventTypes);
	const retainedTypes = sqlStringList(retainedEventTypes);
	const rows = db
		.prepare(
			`
        SELECT id, type, thread_id, turn_id, payload_json, created_at
        FROM events
        WHERE type IN (${retainedTypes})
        ORDER BY id ASC
      `,
		)
		.all();
	const insert = db.prepare(`
    INSERT INTO events_v4 (
      id, type, thread_id, turn_id, is_summary, payload_json, payload_bytes, created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
	for (const row of rows) {
		const isSummary = summaryEventTypes.includes(row.type) ? 1 : 0;
		const payloadJson =
			row.type === "item.created" || row.type === "item.updated"
				? compactItemEventPayload(row.payload_json)
				: validPayloadJson(row.payload_json);
		insert.run(
			row.id,
			row.type,
			row.thread_id,
			row.turn_id,
			isSummary,
			payloadJson,
			payloadBytes(payloadJson),
			row.created_at,
		);
	}
	db.exec(`DELETE FROM events_v4 WHERE type NOT IN (${retainedTypes});`);
	db.exec(
		`UPDATE events_v4 SET is_summary = 1 WHERE type IN (${summaryTypes});`,
	);
}

function replaceTables(db) {
	db.exec(`
    DROP TABLE events;
    DROP TABLE items;
    DROP TABLE turns;
    DROP TABLE threads;
    DROP TABLE hosts;

    ALTER TABLE hosts_v4 RENAME TO hosts;
    ALTER TABLE threads_v4 RENAME TO threads;
    ALTER TABLE turns_v4 RENAME TO turns;
    ALTER TABLE items_v4 RENAME TO items;
    ALTER TABLE events_v4 RENAME TO events;
  `);
}

function createV4Indexes(db) {
	db.exec(`
    CREATE INDEX idx_threads_active_updated_id ON threads(archived_at, updated_at DESC, id DESC);
    CREATE INDEX idx_threads_cwd_active_updated_id ON threads(cwd, archived_at, updated_at DESC, id DESC);
    CREATE INDEX idx_threads_session_id ON threads(session_id);
    CREATE INDEX idx_threads_status_updated_id ON threads(status, updated_at DESC, id DESC);
    CREATE INDEX idx_threads_forked_from_id ON threads(forked_from_id) WHERE forked_from_id IS NOT NULL;
    CREATE INDEX idx_turns_thread_started_id ON turns(thread_id, started_at, id);
    CREATE INDEX idx_items_thread_created_id ON items(thread_id, created_at, id);
    CREATE INDEX idx_events_thread_id ON events(thread_id, id);
    CREATE INDEX idx_events_summary_id ON events(is_summary, id);
  `);
}

function updateEventSequence(db) {
	db.exec(`
    DELETE FROM sqlite_sequence WHERE name = 'events';
    INSERT INTO sqlite_sequence (name, seq)
    SELECT 'events', COALESCE(MAX(id), 0) FROM events;
  `);
}

function assertNoForeignKeyViolations(db) {
	const violations = db.prepare("PRAGMA foreign_key_check").all();
	if (violations.length > 0) {
		throw new Error(
			`Foreign key check failed with ${violations.length} violation(s)`,
		);
	}
}

function migrate(db) {
	db.exec("PRAGMA foreign_keys = OFF");
	db.exec("BEGIN IMMEDIATE");
	try {
		createV4Tables(db);
		copyRelationalData(db);
		copyEvents(db);
		replaceTables(db);
		createV4Indexes(db);
		updateEventSequence(db);
		assertNoForeignKeyViolations(db);
		const result = db
			.prepare(`UPDATE ${metadataTable} SET value = ? WHERE key = ?`)
			.run(toVersion, databaseVersionKey);
		if (result.changes !== 1) {
			throw new Error("Failed to update database version metadata");
		}
		db.exec("COMMIT");
	} catch (error) {
		db.exec("ROLLBACK");
		throw error;
	} finally {
		db.exec("PRAGMA foreign_keys = ON");
	}
}

if (process.argv.length > 3) {
	usage();
	process.exit(1);
}

if (!existsSync(databasePath)) {
	fail(`Database does not exist: ${databasePath}`);
} else {
	const db = new DatabaseSync(databasePath);
	try {
		db.exec("PRAGMA busy_timeout = 5000");
		db.exec("PRAGMA journal_mode = WAL");
		const databaseVersion = readDatabaseVersion(db);
		if (databaseVersion === toVersion) {
			console.log(`Database is already ${toVersion}: ${databasePath}`);
		} else if (databaseVersion !== fromVersion) {
			throw new Error(
				`Unsupported database version ${JSON.stringify(databaseVersion)}; expected "${fromVersion}"`,
			);
		} else {
			migrate(db);
			db.exec("VACUUM");
			db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
			console.log(
				`Upgraded database from ${fromVersion} to ${toVersion}: ${databasePath}`,
			);
		}
	} catch (error) {
		fail(error instanceof Error ? error.message : String(error));
	} finally {
		db.close();
	}
}
