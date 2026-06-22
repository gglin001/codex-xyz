import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { currentDatabaseVersion, Store } from "../src/server/store.js";

let tempDir: string;

beforeEach(() => {
	tempDir = join(
		tmpdir(),
		`coz-store-${Date.now()}-${Math.random().toString(16).slice(2)}`,
	);
	mkdirSync(tempDir, { recursive: true });
});

afterEach(() => {
	rmSync(tempDir, { recursive: true, force: true });
});

function createUnversionedDatabase(filePath: string) {
	const db = new DatabaseSync(filePath);
	db.exec(`
    CREATE TABLE threads (
      id TEXT PRIMARY KEY
    );
  `);
	db.close();
}

function createDatabaseWithVersion(filePath: string, version: string) {
	const db = new DatabaseSync(filePath);
	db.exec(`
    CREATE TABLE database_metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
	db.prepare("INSERT INTO database_metadata (key, value) VALUES (?, ?)").run(
		"database_version",
		version,
	);
	db.close();
}

describe("store database version", () => {
	it("creates v1 databases", () => {
		const filePath = join(tempDir, "fresh.sqlite");
		const store = Store.open(filePath);
		try {
			const db = new DatabaseSync(filePath);
			const row = db
				.prepare("SELECT value FROM database_metadata WHERE key = ?")
				.get("database_version") as { value?: unknown } | undefined;
			db.close();
			expect(row?.value).toBe(currentDatabaseVersion);
		} finally {
			store.close();
		}
	});

	it("rejects existing databases without version metadata", () => {
		const filePath = join(tempDir, "unversioned.sqlite");
		createUnversionedDatabase(filePath);

		expect(() => Store.open(filePath)).toThrow(
			`Database version is missing; expected "${currentDatabaseVersion}"`,
		);
	});

	it("rejects databases with a different version", () => {
		const filePath = join(tempDir, "wrong-version.sqlite");
		createDatabaseWithVersion(filePath, "v0");

		expect(() => Store.open(filePath)).toThrow(
			`Unsupported database version "v0"; expected "${currentDatabaseVersion}"`,
		);
	});
});
