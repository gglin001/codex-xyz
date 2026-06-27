#!/usr/bin/env node
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const fromVersion = "v5";
const toVersion = "v6";
const metadataTable = "metadata";
const versionKey = "version";
const defaultDatabasePath = ".coz/coz.sqlite";

const args = process.argv.slice(2);
const positionalArgs = args[0] === "--" ? args.slice(1) : args;
const databasePath = resolve(positionalArgs[0] ?? defaultDatabasePath);

function usage() {
	console.error(
		`Usage: node scripts/upgrade-v5-to-v6.mjs [${defaultDatabasePath}]`,
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
		.get(versionKey);
	return typeof row?.value === "string" ? row.value : null;
}

function columnExists(db, table, column) {
	return db
		.prepare(`PRAGMA table_info(${table})`)
		.all()
		.some((row) => {
			return row.name === column;
		});
}

function migrate(db) {
	db.exec("BEGIN IMMEDIATE");
	try {
		if (!columnExists(db, "threads", "tag_score")) {
			db.exec(`
        ALTER TABLE threads
        ADD COLUMN tag_score INTEGER CHECK (tag_score IS NULL OR tag_score IN (1, 2, 3))
      `);
		}
		const result = db
			.prepare(`UPDATE ${metadataTable} SET value = ? WHERE key = ?`)
			.run(toVersion, versionKey);
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
