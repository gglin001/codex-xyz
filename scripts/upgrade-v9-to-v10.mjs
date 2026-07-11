#!/usr/bin/env node
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const fromVersion = "v9";
const toVersion = "v10";
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
      ALTER TABLE threads ADD COLUMN parent_thread_id TEXT;
      ALTER TABLE threads ADD COLUMN source_kind TEXT NOT NULL DEFAULT 'unknown'
        CHECK (source_kind IN ('cli', 'vscode', 'exec', 'app_server', 'subagent', 'unknown'));
      ALTER TABLE threads ADD COLUMN agent_nickname TEXT;
      ALTER TABLE threads ADD COLUMN agent_role TEXT;
	  ALTER TABLE threads ADD COLUMN context_window INTEGER;
      CREATE INDEX idx_threads_parent_thread_id
        ON threads(parent_thread_id) WHERE parent_thread_id IS NOT NULL;
    `);
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
	fail(`Usage: node scripts/upgrade-v9-to-v10.mjs [${defaultDatabasePath}]`);
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
