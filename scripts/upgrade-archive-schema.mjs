#!/usr/bin/env node
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const fromVersion = "v1";
const toVersion = "v2";
const metadataTable = "database_metadata";
const databaseVersionKey = "database_version";
const defaultDatabasePath = ".coz/coz.sqlite";

const databasePath = resolve(process.argv[2] ?? defaultDatabasePath);

function usage() {
	console.error(
		`Usage: node scripts/upgrade-archive-schema.mjs [${defaultDatabasePath}]`,
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

function threadColumns(db) {
	if (!tableExists(db, "threads")) {
		throw new Error('Expected table "threads" to exist');
	}
	return db
		.prepare("PRAGMA table_info(threads)")
		.all()
		.map((column) => {
			if (typeof column.name !== "string") {
				throw new Error("Unexpected PRAGMA table_info result");
			}
			return column.name;
		});
}

function ensureArchiveSchema(db) {
	const columns = threadColumns(db);
	if (!columns.includes("archived_at")) {
		db.exec("ALTER TABLE threads ADD COLUMN archived_at TEXT");
	}
	db.exec(
		"CREATE INDEX IF NOT EXISTS idx_threads_active_updated ON threads(archived_at, updated_at DESC)",
	);
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
		const databaseVersion = readDatabaseVersion(db);
		if (databaseVersion === toVersion) {
			const columns = threadColumns(db);
			if (!columns.includes("archived_at")) {
				throw new Error(
					`Database is already ${toVersion}, but threads.archived_at is missing`,
				);
			}
			console.log(`Database is already ${toVersion}: ${databasePath}`);
		} else if (databaseVersion !== fromVersion) {
			throw new Error(
				`Unsupported database version ${JSON.stringify(databaseVersion)}; expected "${fromVersion}"`,
			);
		} else {
			db.exec("BEGIN IMMEDIATE");
			try {
				ensureArchiveSchema(db);
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
			}
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
