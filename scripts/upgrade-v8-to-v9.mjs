#!/usr/bin/env node
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const fromVersion = "v8";
const toVersion = "v9";
const defaultDatabasePath = ".coz/coz.sqlite";
const args = process.argv.slice(2);
const positionalArgs = args[0] === "--" ? args.slice(1) : args;
const databasePath = resolve(positionalArgs[0] ?? defaultDatabasePath);

function fail(message) {
	console.error(message);
	process.exitCode = 1;
}

function tableExists(db, table) {
	return Boolean(
		db
			.prepare("SELECT name FROM sqlite_master WHERE type = ? AND name = ?")
			.get("table", table),
	);
}

function readVersion(db) {
	if (!tableExists(db, "metadata")) return null;
	const row = db
		.prepare("SELECT value FROM metadata WHERE key = ?")
		.get("version");
	return typeof row?.value === "string" ? row.value : null;
}

function migrate(db) {
	db.exec("BEGIN IMMEDIATE");
	try {
		db.exec(`
      ALTER TABLE threads ADD COLUMN lifecycle_state TEXT NOT NULL DEFAULT 'active'
        CHECK (lifecycle_state IN ('active', 'archive_pending', 'archived', 'unarchive_pending', 'archive_failed', 'unarchive_failed', 'missing', 'deleted'));
      ALTER TABLE threads ADD COLUMN desired_archived INTEGER
        CHECK (desired_archived IS NULL OR desired_archived IN (0, 1));
      ALTER TABLE threads ADD COLUMN remote_archived INTEGER
        CHECK (remote_archived IS NULL OR remote_archived IN (0, 1));
      ALTER TABLE threads ADD COLUMN remote_observed_at TEXT;
      ALTER TABLE threads ADD COLUMN remote_updated_at TEXT;
      ALTER TABLE threads ADD COLUMN local_updated_at TEXT NOT NULL DEFAULT '';
      ALTER TABLE threads ADD COLUMN runtime_seen_at TEXT;
      ALTER TABLE threads ADD COLUMN runtime_epoch INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE threads ADD COLUMN sync_generation INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE threads ADD COLUMN state_revision INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE threads ADD COLUMN last_operation_error TEXT;

      UPDATE threads SET
        lifecycle_state = CASE WHEN archived_at IS NULL THEN 'active' ELSE 'archived' END,
        desired_archived = CASE WHEN archived_at IS NULL THEN 0 ELSE 1 END,
        remote_archived = NULL,
        remote_observed_at = NULL,
        remote_updated_at = NULL,
        local_updated_at = updated_at;

      CREATE TABLE thread_operations (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
        kind TEXT NOT NULL CHECK (kind IN ('archive', 'unarchive')),
        status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'succeeded', 'failed')),
        attempts INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX idx_thread_operations_status_created
        ON thread_operations(status, created_at, id);
      CREATE INDEX idx_thread_operations_thread_created
        ON thread_operations(thread_id, created_at DESC, id DESC);
    `);
		const insertMetadata = db.prepare(
			"INSERT INTO metadata (key, value) VALUES (?, ?)",
		);
		insertMetadata.run("thread_lifecycle_revision", "0");
		insertMetadata.run("thread_sync_generation", "0");
		insertMetadata.run("thread_runtime_epoch", "0");
		const result = db
			.prepare("UPDATE metadata SET value = ? WHERE key = ?")
			.run(toVersion, "version");
		if (result.changes !== 1) {
			throw new Error("Failed to update database version metadata");
		}
		db.exec("COMMIT");
	} catch (error) {
		db.exec("ROLLBACK");
		throw error;
	}
}

if (positionalArgs.length > 1) {
	fail(`Usage: node scripts/upgrade-v8-to-v9.mjs [${defaultDatabasePath}]`);
} else if (!existsSync(databasePath)) {
	fail(`Database does not exist: ${databasePath}`);
} else {
	const db = new DatabaseSync(databasePath);
	try {
		db.exec("PRAGMA busy_timeout = 5000");
		db.exec("PRAGMA journal_mode = WAL");
		const version = readVersion(db);
		if (version === toVersion) {
			console.log(`Database is already ${toVersion}: ${databasePath}`);
		} else if (version !== fromVersion) {
			throw new Error(
				`Unsupported database version ${JSON.stringify(version)}; expected "${fromVersion}"`,
			);
		} else {
			migrate(db);
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
