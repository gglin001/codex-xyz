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

function createV3Database(filePath: string) {
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
      forked_from_id TEXT REFERENCES threads(id) ON DELETE SET NULL,
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

    CREATE TABLE turns (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
      status TEXT NOT NULL CHECK (status IN ('in_progress', 'completed', 'interrupted', 'failed')),
      prompt TEXT NOT NULL,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      duration_ms INTEGER
    );

    CREATE TABLE items (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
      turn_id TEXT REFERENCES turns(id) ON DELETE CASCADE,
      type TEXT NOT NULL CHECK (type IN ('user', 'agent', 'plan', 'command', 'file', 'system')),
      text TEXT NOT NULL,
      data_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      thread_id TEXT REFERENCES threads(id) ON DELETE CASCADE,
      turn_id TEXT REFERENCES turns(id) ON DELETE CASCADE,
      is_summary INTEGER NOT NULL CHECK (is_summary IN (0, 1)),
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
	db.prepare("INSERT INTO database_metadata (key, value) VALUES (?, ?)").run(
		"database_version",
		"v3",
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
		"Hello world",
		"{}",
		"2026-06-13T00:00:00.000Z",
	);
	const insertEvent = db.prepare(
		"INSERT INTO events (type, thread_id, turn_id, is_summary, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?)",
	);
	insertEvent.run(
		"thread.started",
		"thread-1",
		null,
		1,
		'{"thread":{"id":"thread-1"}}',
		"2026-06-13T00:00:00.000Z",
	);
	insertEvent.run(
		"thread.renamed",
		"thread-1",
		null,
		1,
		'{"title":"Thread renamed","thread":{"id":"thread-1"}}',
		"2026-06-13T00:00:00.050Z",
	);
	insertEvent.run(
		"item.delta",
		"thread-1",
		"turn-1",
		0,
		'{"itemId":"item-1","delta":"Hello"}',
		"2026-06-13T00:00:00.100Z",
	);
	insertEvent.run(
		"adapter.raw",
		"thread-1",
		"turn-1",
		0,
		'{"method":"item/reasoning/summaryTextDelta"}',
		"2026-06-13T00:00:00.200Z",
	);
	insertEvent.run(
		"item.updated",
		"thread-1",
		"turn-1",
		0,
		'{"item":{"id":"item-1","threadId":"thread-1","turnId":"turn-1","type":"agent","text":"Hello world","createdAt":"2026-06-13T00:00:00.000Z"}}',
		"2026-06-13T00:00:01.000Z",
	);
	db.close();
}

describe("database migrations", () => {
	it("upgrades v3 databases through v5", () => {
		const filePath = join(tempDir, "coz.sqlite");
		createV3Database(filePath);

		execFileSync(process.execPath, ["scripts/upgrade-v3-to-v4.mjs", filePath], {
			stdio: "pipe",
		});
		execFileSync(process.execPath, ["scripts/upgrade-v4-to-v5.mjs", filePath], {
			stdio: "pipe",
		});

		const db = new DatabaseSync(filePath);
		try {
			const version = db
				.prepare("SELECT value FROM metadata WHERE key = ?")
				.get("version") as { value?: unknown } | undefined;
			const legacyMetadata = db
				.prepare(
					"SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
				)
				.get("database_metadata") as { name?: unknown } | undefined;
			const events = db
				.prepare(
					"SELECT type, is_summary, payload_json, payload_bytes FROM events ORDER BY id",
				)
				.all() as Array<{
				type: string;
				is_summary: number;
				payload_json: string;
				payload_bytes: number;
			}>;
			const item = db
				.prepare("SELECT text, text_length, updated_at FROM items WHERE id = ?")
				.get("item-1") as
				| { text: string; text_length: number; updated_at: string }
				| undefined;
			const thread = db
				.prepare("SELECT name FROM threads WHERE id = ?")
				.get("thread-1") as { name?: unknown } | undefined;
			const host = db
				.prepare("SELECT runtime FROM hosts WHERE id = ?")
				.get("local") as { runtime?: unknown } | undefined;

			expect(version?.value).toBe(currentDatabaseVersion);
			expect(legacyMetadata).toBeUndefined();
			expect(thread?.name).toBe("Thread 1");
			expect(host?.runtime).toBe("test");
			expect(events.map((event) => event.type)).toEqual([
				"thread.started",
				"thread.name.updated",
				"item.updated",
			]);
			expect(JSON.parse(events[1]?.payload_json ?? "{}")).toEqual({
				name: "Thread renamed",
				thread: { id: "thread-1" },
			});
			expect(events[2]?.payload_json).not.toContain("Hello world");
			expect(JSON.parse(events[2]?.payload_json ?? "{}")).toEqual({
				itemRef: {
					id: "item-1",
					threadId: "thread-1",
					turnId: "turn-1",
					type: "agent",
					textLength: 11,
					createdAt: "2026-06-13T00:00:00.000Z",
				},
			});
			expect(events[2]?.payload_bytes).toBe(
				Buffer.byteLength(events[2]?.payload_json ?? "", "utf8"),
			);
			expect(item).toEqual({
				text: "Hello world",
				text_length: 11,
				updated_at: "2026-06-13T00:00:00.000Z",
			});
		} finally {
			db.close();
		}

		const store = Store.open(filePath);
		try {
			expect(store.getThreadDetail("thread-1")?.items[0]?.text).toBe(
				"Hello world",
			);
		} finally {
			store.close();
		}
	});
});
