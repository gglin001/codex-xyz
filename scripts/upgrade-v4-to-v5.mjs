#!/usr/bin/env node
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const fromVersion = "v4";
const toVersion = "v5";
const sourceMetadataTable = "database_metadata";
const sourceVersionKey = "database_version";
const metadataTable = "metadata";
const versionKey = "version";
const defaultDatabasePath = ".coz/coz.sqlite";

const databasePath = resolve(process.argv[2] ?? defaultDatabasePath);

function usage() {
	console.error(
		`Usage: node scripts/upgrade-v4-to-v5.mjs [${defaultDatabasePath}]`,
	);
}

function fail(message) {
	console.error(message);
	process.exitCode = 1;
}

function jsonText(value) {
	return JSON.stringify(value);
}

function sqlString(value) {
	return `'${value.replaceAll("'", "''")}'`;
}

function payloadBytes(payloadJson) {
	return Buffer.byteLength(payloadJson, "utf8");
}

function migrateEventPayload(type, payloadJson) {
	if (type !== "thread.renamed") {
		return payloadJson;
	}
	let payload;
	try {
		payload = JSON.parse(payloadJson);
	} catch {
		return "{}";
	}
	if (
		payload &&
		typeof payload === "object" &&
		"title" in payload &&
		!("name" in payload)
	) {
		const { title, ...rest } = payload;
		return jsonText({ ...rest, name: title });
	}
	return payloadJson;
}

function tableExists(db, table) {
	const row = db
		.prepare("SELECT name FROM sqlite_master WHERE type = ? AND name = ?")
		.get("table", table);
	return Boolean(row);
}

function readSourceDatabaseVersion(db) {
	if (!tableExists(db, sourceMetadataTable)) {
		return null;
	}
	const row = db
		.prepare(`SELECT value FROM ${sourceMetadataTable} WHERE key = ?`)
		.get(sourceVersionKey);
	return typeof row?.value === "string" ? row.value : null;
}

function createV5Tables(db) {
	db.exec(`
    CREATE TABLE ${metadataTable}_v5 (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE hosts_v5 (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      runtime TEXT NOT NULL,
      version TEXT,
      default_cwd TEXT,
      last_seen_at TEXT NOT NULL
    );

    CREATE TABLE threads_v5 (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      forked_from_id TEXT REFERENCES threads_v5(id) ON DELETE SET NULL,
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
      archived_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE turns_v5 (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL REFERENCES threads_v5(id) ON DELETE CASCADE,
      status TEXT NOT NULL CHECK (status IN ('in_progress', 'completed', 'interrupted', 'failed')),
      prompt TEXT NOT NULL,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      duration_ms INTEGER
    );

    CREATE TABLE items_v5 (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL REFERENCES threads_v5(id) ON DELETE CASCADE,
      turn_id TEXT REFERENCES turns_v5(id) ON DELETE CASCADE,
      type TEXT NOT NULL CHECK (type IN ('user', 'agent', 'plan', 'command', 'file', 'system')),
      text TEXT NOT NULL,
      data_json TEXT NOT NULL CHECK (json_valid(data_json)),
      text_length INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE events_v5 (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      thread_id TEXT REFERENCES threads_v5(id) ON DELETE CASCADE,
      turn_id TEXT REFERENCES turns_v5(id) ON DELETE CASCADE,
      is_summary INTEGER NOT NULL CHECK (is_summary IN (0, 1)),
      payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
      payload_bytes INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
  `);
}

function copyData(db) {
	db.exec(`
    INSERT INTO ${metadataTable}_v5 (key, value)
    VALUES (${sqlString(versionKey)}, ${sqlString(toVersion)});

    INSERT INTO hosts_v5 (id, name, runtime, version, default_cwd, last_seen_at)
    SELECT id, name, adapter, version, default_cwd, last_seen_at FROM hosts;

    INSERT INTO threads_v5 (
      id, session_id, forked_from_id, name, preview, cwd, model, status,
      active_turn_id, last_turn_status, goal_objective, goal_status,
      goal_token_budget, tokens_used, archived_at, created_at, updated_at
    )
    SELECT
      id, session_id, forked_from_id, title, preview, cwd, model, status,
      active_turn_id, last_turn_status, goal_objective, goal_status,
      goal_token_budget, tokens_used, archived_at, created_at, updated_at
    FROM threads;

    INSERT INTO turns_v5 (
      id, thread_id, status, prompt, started_at, completed_at, duration_ms
    )
    SELECT id, thread_id, status, prompt, started_at, completed_at, duration_ms
    FROM turns;

    INSERT INTO items_v5 (
      id, thread_id, turn_id, type, text, data_json, text_length, updated_at, created_at
    )
    SELECT
      id, thread_id, turn_id, type, text, data_json, text_length, updated_at, created_at
    FROM items;

  `);

	const rows = db
		.prepare(
			`
        SELECT id, type, thread_id, turn_id, is_summary, payload_json, created_at
        FROM events
        ORDER BY id ASC
      `,
		)
		.all();
	const insertEvent = db.prepare(`
    INSERT INTO events_v5 (
      id, type, thread_id, turn_id, is_summary, payload_json, payload_bytes, created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
	for (const row of rows) {
		const type =
			row.type === "thread.renamed" ? "thread.name.updated" : row.type;
		const payloadJson = migrateEventPayload(row.type, row.payload_json);
		insertEvent.run(
			row.id,
			type,
			row.thread_id,
			row.turn_id,
			row.is_summary,
			payloadJson,
			payloadBytes(payloadJson),
			row.created_at,
		);
	}
}

function replaceTables(db) {
	db.exec(`
    DROP TABLE events;
    DROP TABLE items;
    DROP TABLE turns;
    DROP TABLE threads;
    DROP TABLE hosts;
    DROP TABLE database_metadata;

    ALTER TABLE ${metadataTable}_v5 RENAME TO ${metadataTable};
    ALTER TABLE hosts_v5 RENAME TO hosts;
    ALTER TABLE threads_v5 RENAME TO threads;
    ALTER TABLE turns_v5 RENAME TO turns;
    ALTER TABLE items_v5 RENAME TO items;
    ALTER TABLE events_v5 RENAME TO events;
  `);
}

function createIndexes(db) {
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
		createV5Tables(db);
		copyData(db);
		replaceTables(db);
		createIndexes(db);
		updateEventSequence(db);
		assertNoForeignKeyViolations(db);
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
		const sourceDatabaseVersion = readSourceDatabaseVersion(db);
		if (sourceDatabaseVersion !== fromVersion) {
			throw new Error(
				`Unsupported database version ${JSON.stringify(sourceDatabaseVersion)}; expected "${fromVersion}"`,
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
