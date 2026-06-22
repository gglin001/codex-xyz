import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ControlThread } from "../src/server/domain.js";
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

function createLegacyV1Database(filePath: string) {
	const db = new DatabaseSync(filePath);
	db.exec(`
    CREATE TABLE database_metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
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
  `);
	db.prepare("INSERT INTO database_metadata (key, value) VALUES (?, ?)").run(
		"database_version",
		currentDatabaseVersion,
	);
	db.close();
}

function threadFixture(id: string): ControlThread {
	return {
		id,
		sessionId: id,
		forkedFromId: null,
		title: `Thread ${id}`,
		preview: "Preview",
		cwd: tempDir,
		model: "test-model",
		status: "idle",
		activeTurnId: null,
		lastTurnStatus: null,
		goalObjective: null,
		goalStatus: null,
		goalTokenBudget: null,
		tokensUsed: 0,
		archivedAt: null,
		createdAt: "2026-06-13T00:00:00.000Z",
		updatedAt: "2026-06-13T00:00:00.000Z",
	};
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

	it("adds archive columns to existing v1 databases", () => {
		const filePath = join(tempDir, "legacy-v1.sqlite");
		createLegacyV1Database(filePath);

		const store = Store.open(filePath);
		try {
			const db = new DatabaseSync(filePath);
			const columns = db.prepare("PRAGMA table_info(threads)").all() as Array<{
				name?: unknown;
			}>;
			db.close();
			expect(columns.some((column) => column.name === "archived_at")).toBe(
				true,
			);
		} finally {
			store.close();
		}
	});

	it("keeps archived threads out of default list queries", () => {
		const store = Store.open(":memory:");
		try {
			store.createThread(threadFixture("thread-active"));
			store.createThread(threadFixture("thread-archived"));
			store.archiveThread("thread-archived", "2026-06-13T00:10:00.000Z");

			expect(store.countThreads()).toBe(1);
			expect(store.listThreads().map((thread) => thread.id)).toEqual([
				"thread-active",
			]);
			expect(store.countThreads({ archived: true })).toBe(1);
			const archivedThreads = store.listThreads({ archived: true });
			expect(archivedThreads.map((thread) => thread.id)).toEqual([
				"thread-archived",
			]);
			expect(archivedThreads[0]?.archivedAt).toBe("2026-06-13T00:10:00.000Z");
		} finally {
			store.close();
		}
	});
});
