import { mkdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { Store } from "../src/server/store.js"
import { migrateStateModel } from "../scripts/migrate-state-model.mjs"

let tempDir: string

beforeEach(() => {
  tempDir = join(tmpdir(), `codex-xyz-store-${Date.now()}-${Math.random().toString(16).slice(2)}`)
  mkdirSync(tempDir, { recursive: true })
})

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true })
})

function createLegacyDatabase(filePath: string) {
  const db = new DatabaseSync(filePath)
  db.exec(`
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
      goal_objective TEXT,
      goal_status TEXT,
      goal_token_budget INTEGER,
      tokens_used INTEGER NOT NULL DEFAULT 0,
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
  `)
  return db
}

describe("state model migration script", () => {
  it("creates current-schema databases without requiring the migration script", () => {
    const filePath = join(tempDir, "fresh.sqlite")
    const store = Store.open(filePath)
    try {
      const db = new DatabaseSync(filePath)
      const columns = db.prepare("PRAGMA table_info(threads)").all() as Array<{ name?: unknown }>
      db.close()
      expect(columns.some((row) => row.name === "last_turn_status")).toBe(true)
    } finally {
      store.close()
    }
  })

  it("splits legacy thread runtime status from latest turn lifecycle status", () => {
    const filePath = join(tempDir, "legacy.sqlite")
    const db = createLegacyDatabase(filePath)
    const insertThread = db.prepare(`
      INSERT INTO threads (
        id, session_id, forked_from_id, title, preview, cwd, model,
        status, active_turn_id, goal_objective, goal_status, goal_token_budget,
        tokens_used, created_at, updated_at
      )
      VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, 0, ?, ?)
    `)
    const insertTurn = db.prepare(`
      INSERT INTO turns (id, thread_id, status, prompt, started_at, completed_at, duration_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
    const createdAt = "2026-01-01T00:00:00.000Z"

    insertThread.run(
      "thread-active",
      "session-active",
      "Active",
      "Active preview",
      tempDir,
      "gpt-test",
      "running",
      "turn-active",
      createdAt,
      createdAt
    )
    insertTurn.run("turn-active", "thread-active", "running", "Still running", createdAt, null, null)

    insertThread.run(
      "thread-turn-failed",
      "session-turn-failed",
      "Turn failed",
      "Turn failed preview",
      tempDir,
      "gpt-test",
      "failed",
      null,
      createdAt,
      createdAt
    )
    insertTurn.run(
      "turn-failed",
      "thread-turn-failed",
      "failed",
      "Failed turn",
      createdAt,
      "2026-01-01T00:00:01.000Z",
      1000
    )

    insertThread.run(
      "thread-system-error",
      "session-system-error",
      "System error",
      "System error preview",
      tempDir,
      "gpt-test",
      "failed",
      null,
      createdAt,
      createdAt
    )

    db.close()

    const result = migrateStateModel(filePath, { backupPath: false })
    expect(result.changed).toBe(true)

    const store = Store.open(filePath)
    try {
      expect(store.getThread("thread-active")).toMatchObject({
        status: "active",
        activeTurnId: "turn-active",
        lastTurnStatus: "in_progress"
      })
      expect(store.getTurn("turn-active")?.status).toBe("in_progress")

      expect(store.getThread("thread-turn-failed")).toMatchObject({
        status: "idle",
        activeTurnId: null,
        lastTurnStatus: "failed"
      })
      expect(store.getTurn("turn-failed")?.status).toBe("failed")

      expect(store.getThread("thread-system-error")).toMatchObject({
        status: "system_error",
        activeTurnId: null,
        lastTurnStatus: null
      })
    } finally {
      store.close()
    }
  })

  it("requires explicit migration before opening a legacy state database", () => {
    const filePath = join(tempDir, "legacy-unmigrated.sqlite")
    const db = createLegacyDatabase(filePath)
    db.prepare(`
      INSERT INTO threads (
        id, session_id, forked_from_id, title, preview, cwd, model,
        status, active_turn_id, goal_objective, goal_status, goal_token_budget,
        tokens_used, created_at, updated_at
      )
      VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, 0, ?, ?)
    `).run(
      "thread-active",
      "session-active",
      "Active",
      "Active preview",
      tempDir,
      "gpt-test",
      "running",
      "turn-active",
      "2026-01-01T00:00:00.000Z",
      "2026-01-01T00:00:00.000Z"
    )
    db.close()

    expect(() => Store.open(filePath)).toThrow(/Database schema is not current/)
  })
})
