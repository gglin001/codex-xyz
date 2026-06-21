#!/usr/bin/env node

import { copyFileSync, existsSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { DatabaseSync } from "node:sqlite"

const defaultDatabasePath = ".codex-xyz/codex-xyz.sqlite"

function usage() {
  return [
    "Usage: node scripts/migrate-state-model.mjs [database-path]",
    "",
    `Default database path: ${defaultDatabasePath}`,
    "",
    "Migrates legacy codex-xyz thread/turn status data to the app-server aligned model.",
    "A sibling .bak-<timestamp> backup is created before changes are written."
  ].join("\n")
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-")
}

function addColumnIfMissing(db, table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all()
  if (!columns.some((row) => row.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
  }
}

function tableExists(db, table) {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(table)
  return Boolean(row)
}

function invalidValues(db, table, column, allowed) {
  const placeholders = allowed.map(() => "?").join(", ")
  return db
    .prepare(`SELECT DISTINCT ${column} AS value FROM ${table} WHERE ${column} IS NOT NULL AND ${column} NOT IN (${placeholders})`)
    .all(...allowed)
    .map((row) => String(row.value))
}

export function migrateStateModel(databasePathInput = defaultDatabasePath, options = {}) {
  const databasePath = resolve(databasePathInput)
  if (!existsSync(databasePath)) {
    throw new Error(`Database does not exist: ${databasePath}`)
  }

  const backupPath = options.backupPath === false ? null : (options.backupPath ?? `${databasePath}.bak-${timestamp()}`)
  if (backupPath) {
    copyFileSync(databasePath, backupPath)
  }

  const db = new DatabaseSync(databasePath)
  let changed = false
  try {
    db.exec("PRAGMA foreign_keys = ON")

    if (!tableExists(db, "threads") || !tableExists(db, "turns")) {
      throw new Error("Expected threads and turns tables to exist")
    }

    db.exec("BEGIN")
    try {
      addColumnIfMissing(db, "threads", "last_turn_status", "TEXT")
      addColumnIfMissing(db, "threads", "goal_token_budget", "INTEGER")

      const before = db.prepare(`
        SELECT
          (SELECT COUNT(*) FROM threads WHERE status IN ('running', 'stale', 'failed', 'completed', 'interrupted')) AS legacy_threads,
          (SELECT COUNT(*) FROM turns WHERE status = 'running') AS legacy_turns,
          (SELECT COUNT(*) FROM threads WHERE last_turn_status = 'running') AS legacy_last_turns
      `).get()

      db.exec(`
        UPDATE turns
        SET status = CASE status
          WHEN 'running' THEN 'in_progress'
          ELSE status
        END;

        UPDATE threads
        SET last_turn_status = CASE last_turn_status
          WHEN 'running' THEN 'in_progress'
          ELSE last_turn_status
        END
        WHERE last_turn_status IS NOT NULL;

        UPDATE threads
        SET last_turn_status = (
          SELECT turns.status
          FROM turns
          WHERE turns.thread_id = threads.id
          ORDER BY turns.started_at DESC, turns.id DESC
          LIMIT 1
        )
        WHERE last_turn_status IS NULL;

        UPDATE threads
        SET status = CASE status
          WHEN 'running' THEN 'active'
          WHEN 'stale' THEN 'not_loaded'
          WHEN 'failed' THEN CASE last_turn_status
            WHEN 'failed' THEN 'idle'
            ELSE 'system_error'
          END
          WHEN 'completed' THEN 'idle'
          WHEN 'interrupted' THEN 'idle'
          ELSE status
        END;
      `)

      const invalidThreadStatuses = invalidValues(db, "threads", "status", [
        "idle",
        "active",
        "not_loaded",
        "system_error"
      ])
      const invalidTurnStatuses = invalidValues(db, "turns", "status", [
        "in_progress",
        "completed",
        "interrupted",
        "failed"
      ])
      const invalidLastTurnStatuses = invalidValues(db, "threads", "last_turn_status", [
        "in_progress",
        "completed",
        "interrupted",
        "failed"
      ])

      if (invalidThreadStatuses.length > 0 || invalidTurnStatuses.length > 0 || invalidLastTurnStatuses.length > 0) {
        throw new Error(
          [
            "Database still contains invalid status values after migration.",
            `threads.status: ${invalidThreadStatuses.join(", ") || "none"}`,
            `turns.status: ${invalidTurnStatuses.join(", ") || "none"}`,
            `threads.last_turn_status: ${invalidLastTurnStatuses.join(", ") || "none"}`
          ].join("\n")
        )
      }

      db.exec("COMMIT")
      changed =
        Number(before.legacy_threads) > 0 ||
        Number(before.legacy_turns) > 0 ||
        Number(before.legacy_last_turns) > 0
    } catch (error) {
      db.exec("ROLLBACK")
      throw error
    }
  } finally {
    db.close()
  }

  return {
    databasePath,
    backupPath,
    changed
  }
}

function isMainModule() {
  return process.argv[1] ? resolve(process.argv[1]) === import.meta.filename : false
}

if (isMainModule()) {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log(usage())
    process.exit(0)
  }
  const databasePath = process.argv[2] ?? defaultDatabasePath
  try {
    const result = migrateStateModel(databasePath)
    console.log(`Migrated ${result.databasePath}`)
    if (result.backupPath) {
      console.log(`Backup ${result.backupPath}`)
    }
    console.log(result.changed ? "Legacy status values were updated." : "No legacy status values were found.")
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}
