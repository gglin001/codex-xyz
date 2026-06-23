import { execFileSync } from "node:child_process";
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
		`coz-migration-${Date.now()}-${Math.random().toString(16).slice(2)}`,
	);
	mkdirSync(tempDir, { recursive: true });
});

afterEach(() => {
	rmSync(tempDir, { recursive: true, force: true });
});

function createV2Database(filePath: string) {
	const db = new DatabaseSync(filePath);
	db.exec(`
    CREATE TABLE database_metadata (
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
      archived_at TEXT,
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
  `);
	db.prepare("INSERT INTO database_metadata (key, value) VALUES (?, ?)").run(
		"database_version",
		"v2",
	);
	db.prepare(
		"INSERT INTO hosts (id, name, adapter, version, default_cwd, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)",
	).run(
		"local",
		"Local host",
		"test",
		null,
		tempDir,
		"2026-06-13T00:00:00.000Z",
	);
	db.prepare(
		`
      INSERT INTO threads (
        id, session_id, forked_from_id, title, preview, cwd, model, status,
        active_turn_id, last_turn_status, goal_objective, goal_status,
        goal_token_budget, tokens_used, archived_at, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
	).run(
		"thread-1",
		"session-1",
		null,
		"Thread 1",
		"Preview",
		tempDir,
		"test-model",
		"idle",
		null,
		"completed",
		null,
		null,
		null,
		12,
		null,
		"2026-06-13T00:00:00.000Z",
		"2026-06-13T00:00:01.000Z",
	);
	db.prepare(
		"INSERT INTO turns (id, thread_id, status, prompt, started_at, completed_at, duration_ms) VALUES (?, ?, ?, ?, ?, ?, ?)",
	).run(
		"turn-1",
		"thread-1",
		"completed",
		"Prompt",
		"2026-06-13T00:00:00.000Z",
		"2026-06-13T00:00:01.000Z",
		1000,
	);
	db.prepare(
		"INSERT INTO items (id, thread_id, turn_id, type, text, data_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
	).run(
		"item-1",
		"thread-1",
		"turn-1",
		"agent",
		"Hello",
		"{}",
		"2026-06-13T00:00:00.000Z",
	);
	const insertEvent = db.prepare(
		"INSERT INTO events (type, thread_id, turn_id, payload_json, created_at) VALUES (?, ?, ?, ?, ?)",
	);
	insertEvent.run(
		"thread.started",
		"thread-1",
		null,
		'{"thread":{"id":"thread-1"}}',
		"2026-06-13T00:00:00.000Z",
	);
	insertEvent.run(
		"item.delta",
		"thread-1",
		"turn-1",
		'{"itemId":"item-1","delta":"Hello","item":{"text":"Hello"}}',
		"2026-06-13T00:00:00.100Z",
	);
	insertEvent.run(
		"adapter.raw",
		"thread-1",
		"turn-1",
		'{"method":"item/reasoning/summaryTextDelta"}',
		"2026-06-13T00:00:00.200Z",
	);
	insertEvent.run(
		"thread.continued",
		"thread-1",
		null,
		"{}",
		"2026-06-13T00:00:00.300Z",
	);
	insertEvent.run(
		"item.updated",
		"thread-1",
		"turn-1",
		'{"item":{"id":"item-1","text":"Hello"}}',
		"2026-06-13T00:00:01.000Z",
	);
	db.close();
}

describe("v2 to v3 migration", () => {
	it("compacts event storage and produces a current database", () => {
		const filePath = join(tempDir, "coz.sqlite");
		createV2Database(filePath);

		execFileSync(process.execPath, ["scripts/upgrade-v2-to-v3.mjs", filePath], {
			stdio: "pipe",
		});

		const db = new DatabaseSync(filePath);
		try {
			const version = db
				.prepare("SELECT value FROM database_metadata WHERE key = ?")
				.get("database_version") as { value?: unknown } | undefined;
			const events = db
				.prepare("SELECT type, is_summary FROM events ORDER BY id")
				.all() as Array<{ type: string; is_summary: number }>;
			const indexes = db
				.prepare(
					"SELECT name FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_%' ORDER BY name",
				)
				.all() as Array<{ name: string }>;

			expect(version?.value).toBe(currentDatabaseVersion);
			expect(events).toEqual([
				{ type: "thread.started", is_summary: 1 },
				{ type: "item.updated", is_summary: 0 },
			]);
			expect(indexes.map((index) => index.name)).toContain(
				"idx_events_summary_id",
			);
		} finally {
			db.close();
		}

		const store = Store.open(filePath);
		try {
			expect(store.getThreadDetail("thread-1")?.items[0]?.text).toBe("Hello");
		} finally {
			store.close();
		}
	});
});
