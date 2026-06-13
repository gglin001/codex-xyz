import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  type ControlThread,
  type EvalRun,
  type GoalStatus,
  type ItemType,
  isSummaryEventType,
  nowIso,
  type Project,
  type PromptRecipe,
  type RuntimeStatus,
  summaryEventTypes,
  type Task,
  type TaskStatus,
  type ThreadDetail,
  type ThreadItem,
  type Turn,
  type XyzEvent
} from "./domain.js";

type Row = Record<string, unknown>;

type EventReplayOptions = {
  threadId?: string | null;
  summaryOnly?: boolean;
};

type ThreadListOptions = {
  limit?: number | null;
  offset?: number | null;
};

function readJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string" || value.length === 0) {
    return fallback;
  }
  return JSON.parse(value) as T;
}

function scalarString(value: unknown) {
  if (typeof value !== "string") {
    throw new Error("Expected string column");
  }
  return value;
}

function scalarNumber(value: unknown) {
  if (typeof value !== "number") {
    throw new Error("Expected number column");
  }
  return value;
}

function nullableString(value: unknown) {
  return typeof value === "string" ? value : null;
}

function projectFromRow(row: Row): Project {
  return {
    id: scalarString(row.id),
    name: scalarString(row.name),
    path: scalarString(row.path),
    gitRemote: nullableString(row.git_remote),
    defaultBranch: nullableString(row.default_branch),
    tags: readJson<string[]>(row.tags_json, []),
    createdAt: scalarString(row.created_at),
    updatedAt: scalarString(row.updated_at)
  };
}

function threadFromRow(row: Row): ControlThread {
  return {
    id: scalarString(row.id),
    sessionId: scalarString(row.session_id),
    forkedFromId: nullableString(row.forked_from_id),
    projectId: scalarString(row.project_id),
    title: scalarString(row.title),
    preview: scalarString(row.preview),
    cwd: scalarString(row.cwd),
    model: nullableString(row.model),
    status: scalarString(row.status) as RuntimeStatus,
    activeTurnId: nullableString(row.active_turn_id),
    goalObjective: nullableString(row.goal_objective),
    goalStatus: nullableString(row.goal_status) as GoalStatus | null,
    goalTokenBudget: typeof row.goal_token_budget === "number" ? row.goal_token_budget : null,
    tokensUsed: scalarNumber(row.tokens_used),
    createdAt: scalarString(row.created_at),
    updatedAt: scalarString(row.updated_at)
  };
}

function turnFromRow(row: Row): Turn {
  return {
    id: scalarString(row.id),
    threadId: scalarString(row.thread_id),
    status: scalarString(row.status) as RuntimeStatus,
    prompt: scalarString(row.prompt),
    startedAt: scalarString(row.started_at),
    completedAt: nullableString(row.completed_at),
    durationMs: typeof row.duration_ms === "number" ? row.duration_ms : null
  };
}

function itemFromRow(row: Row): ThreadItem {
  return {
    id: scalarString(row.id),
    threadId: scalarString(row.thread_id),
    turnId: nullableString(row.turn_id),
    type: scalarString(row.type) as ItemType,
    text: scalarString(row.text),
    data: readJson<Record<string, unknown>>(row.data_json, {}),
    createdAt: scalarString(row.created_at)
  };
}

function taskFromRow(row: Row): Task {
  return {
    id: scalarString(row.id),
    projectId: scalarString(row.project_id),
    threadId: nullableString(row.thread_id),
    title: scalarString(row.title),
    prompt: scalarString(row.prompt),
    recipeId: nullableString(row.recipe_id),
    status: scalarString(row.status) as TaskStatus,
    createdAt: scalarString(row.created_at),
    updatedAt: scalarString(row.updated_at)
  };
}

function recipeFromRow(row: Row): PromptRecipe {
  return {
    id: scalarString(row.id),
    name: scalarString(row.name),
    prompt: scalarString(row.prompt),
    variables: readJson<string[]>(row.variables_json, []),
    createdAt: scalarString(row.created_at)
  };
}

function eventFromRow(row: Row): XyzEvent {
  return {
    id: scalarNumber(row.id),
    type: scalarString(row.type),
    threadId: nullableString(row.thread_id),
    turnId: nullableString(row.turn_id),
    payload: readJson<Record<string, unknown>>(row.payload_json, {}),
    createdAt: scalarString(row.created_at)
  };
}

export class Store {
  constructor(private readonly db: DatabaseSync) {}

  static open(filePath: string) {
    if (filePath !== ":memory:") {
      mkdirSync(dirname(filePath), { recursive: true });
    }
    const db = new DatabaseSync(filePath);
    const store = new Store(db);
    store.configure();
    store.migrate();
    return store;
  }

  close() {
    this.db.close();
  }

  configure() {
    this.db.exec("PRAGMA foreign_keys = ON");
    this.db.exec("PRAGMA journal_mode = WAL");
  }

  migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS hosts (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        adapter TEXT NOT NULL,
        version TEXT,
        last_seen_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        path TEXT NOT NULL UNIQUE,
        git_remote TEXT,
        default_branch TEXT,
        tags_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS threads (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        forked_from_id TEXT,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
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

      CREATE TABLE IF NOT EXISTS turns (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
        status TEXT NOT NULL,
        prompt TEXT NOT NULL,
        started_at TEXT NOT NULL,
        completed_at TEXT,
        duration_ms INTEGER
      );

      CREATE TABLE IF NOT EXISTS items (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
        turn_id TEXT REFERENCES turns(id) ON DELETE CASCADE,
        type TEXT NOT NULL,
        text TEXT NOT NULL,
        data_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL,
        thread_id TEXT,
        turn_id TEXT,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        thread_id TEXT REFERENCES threads(id) ON DELETE SET NULL,
        title TEXT NOT NULL,
        prompt TEXT NOT NULL,
        recipe_id TEXT,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS prompt_recipes (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        prompt TEXT NOT NULL,
        variables_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS eval_runs (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        command TEXT NOT NULL,
        status TEXT NOT NULL,
        output TEXT,
        created_at TEXT NOT NULL,
        completed_at TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_threads_project ON threads(project_id);
      CREATE INDEX IF NOT EXISTS idx_threads_updated ON threads(updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_turns_thread ON turns(thread_id);
      CREATE INDEX IF NOT EXISTS idx_turns_thread_started ON turns(thread_id, started_at);
      CREATE INDEX IF NOT EXISTS idx_items_thread ON items(thread_id);
      CREATE INDEX IF NOT EXISTS idx_items_thread_created ON items(thread_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_events_thread ON events(thread_id);
      CREATE INDEX IF NOT EXISTS idx_events_thread_id ON events(thread_id, id);
      CREATE INDEX IF NOT EXISTS idx_events_type_id ON events(type, id);
      CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
      CREATE INDEX IF NOT EXISTS idx_tasks_updated ON tasks(updated_at DESC);
      DROP TABLE IF EXISTS approvals;
    `);
    this.addColumnIfMissing("threads", "goal_token_budget", "INTEGER");
  }

  private addColumnIfMissing(table: string, column: string, definition: string) {
    const columns = this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name?: unknown }>;
    if (!columns.some((row) => row.name === column)) {
      this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  }

  upsertHost(input: { id: string; name: string; adapter: string; version?: string | null }) {
    const seen = nowIso();
    this.db
      .prepare(
        `
          INSERT INTO hosts (id, name, adapter, version, last_seen_at)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            adapter = excluded.adapter,
            version = excluded.version,
            last_seen_at = excluded.last_seen_at
        `
      )
      .run(input.id, input.name, input.adapter, input.version ?? null, seen);
  }

  createProject(input: {
    id: string;
    name: string;
    path: string;
    gitRemote?: string | null;
    defaultBranch?: string | null;
    tags?: string[];
  }) {
    const now = nowIso();
    this.db
      .prepare(
        `
          INSERT INTO projects (id, name, path, git_remote, default_branch, tags_json, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(path) DO UPDATE SET
            name = excluded.name,
            git_remote = excluded.git_remote,
            default_branch = excluded.default_branch,
            tags_json = excluded.tags_json,
            updated_at = excluded.updated_at
        `
      )
      .run(
        input.id,
        input.name,
        input.path,
        input.gitRemote ?? null,
        input.defaultBranch ?? null,
        JSON.stringify(input.tags ?? []),
        now,
        now
      );
    return this.getProjectByPath(input.path);
  }

  listProjects() {
    return this.db
      .prepare("SELECT * FROM projects ORDER BY name ASC")
      .all()
      .map((row) => projectFromRow(row as Row));
  }

  getProject(id: string) {
    const row = this.db.prepare("SELECT * FROM projects WHERE id = ?").get(id);
    return row ? projectFromRow(row as Row) : null;
  }

  getProjectByPath(path: string) {
    const row = this.db.prepare("SELECT * FROM projects WHERE path = ?").get(path);
    return row ? projectFromRow(row as Row) : null;
  }

  createThread(thread: ControlThread) {
    this.db
      .prepare(
        `
          INSERT INTO threads (
            id, session_id, forked_from_id, project_id, title, preview, cwd, model,
            status, active_turn_id, goal_objective, goal_status, goal_token_budget,
            tokens_used, created_at, updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
      )
      .run(
        thread.id,
        thread.sessionId,
        thread.forkedFromId,
        thread.projectId,
        thread.title,
        thread.preview,
        thread.cwd,
        thread.model,
        thread.status,
        thread.activeTurnId,
        thread.goalObjective,
        thread.goalStatus,
        thread.goalTokenBudget,
        thread.tokensUsed,
        thread.createdAt,
        thread.updatedAt
      );
    return this.getThread(thread.id);
  }

  updateThread(
    id: string,
    updates: Partial<
      Pick<
        ControlThread,
        "status" | "activeTurnId" | "goalObjective" | "goalStatus" | "goalTokenBudget" | "tokensUsed" | "title" | "preview"
      >
    >
  ) {
    const existing = this.getThread(id);
    if (!existing) {
      throw new Error(`Thread ${id} does not exist`);
    }
    const next = { ...existing, ...updates, updatedAt: nowIso() };
    this.db
      .prepare(
        `
          UPDATE threads SET
            title = ?,
            preview = ?,
            status = ?,
            active_turn_id = ?,
            goal_objective = ?,
            goal_status = ?,
            goal_token_budget = ?,
            tokens_used = ?,
            updated_at = ?
          WHERE id = ?
        `
      )
      .run(
        next.title,
        next.preview,
        next.status,
        next.activeTurnId,
        next.goalObjective,
        next.goalStatus,
        next.goalTokenBudget,
        next.tokensUsed,
        next.updatedAt,
        id
      );
    return this.getThread(id);
  }

  getThread(id: string) {
    const row = this.db.prepare("SELECT * FROM threads WHERE id = ?").get(id);
    return row ? threadFromRow(row as Row) : null;
  }

  countThreads() {
    const row = this.db.prepare("SELECT COUNT(*) AS count FROM threads").get() as Row | undefined;
    return row ? scalarNumber(row.count) : 0;
  }

  listThreads(options: ThreadListOptions = {}) {
    const limit = options.limit ?? null;
    const offset = options.offset ?? null;
    if (limit !== null) {
      return this.db
        .prepare("SELECT * FROM threads ORDER BY updated_at DESC, id DESC LIMIT ? OFFSET ?")
        .all(limit, offset ?? 0)
        .map((row) => threadFromRow(row as Row));
    }
    return this.db
      .prepare("SELECT * FROM threads ORDER BY updated_at DESC, id DESC")
      .all()
      .map((row) => threadFromRow(row as Row));
  }

  getThreadDetail(id: string): ThreadDetail | null {
    const latestEventId = this.getLatestEventIdForThread(id);
    const thread = this.getThread(id);
    if (!thread) {
      return null;
    }
    return {
      ...thread,
      turns: this.listTurns(id),
      items: this.listItems(id),
      latestEventId
    };
  }

  createTurn(turn: Turn) {
    this.db
      .prepare(
        `
          INSERT INTO turns (id, thread_id, status, prompt, started_at, completed_at, duration_ms)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `
      )
      .run(turn.id, turn.threadId, turn.status, turn.prompt, turn.startedAt, turn.completedAt, turn.durationMs);
    return this.getTurn(turn.id);
  }

  updateTurn(id: string, updates: Partial<Pick<Turn, "status" | "prompt" | "completedAt" | "durationMs">>) {
    const existing = this.getTurn(id);
    if (!existing) {
      throw new Error(`Turn ${id} does not exist`);
    }
    const next = { ...existing, ...updates };
    this.db
      .prepare("UPDATE turns SET status = ?, prompt = ?, completed_at = ?, duration_ms = ? WHERE id = ?")
      .run(next.status, next.prompt, next.completedAt, next.durationMs, id);
    return this.getTurn(id);
  }

  getTurn(id: string) {
    const row = this.db.prepare("SELECT * FROM turns WHERE id = ?").get(id);
    return row ? turnFromRow(row as Row) : null;
  }

  listTurns(threadId: string) {
    return this.db
      .prepare("SELECT * FROM turns WHERE thread_id = ? ORDER BY started_at ASC")
      .all(threadId)
      .map((row) => turnFromRow(row as Row));
  }

  createItem(item: ThreadItem) {
    this.db
      .prepare(
        `
          INSERT INTO items (id, thread_id, turn_id, type, text, data_json, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            thread_id = excluded.thread_id,
            turn_id = excluded.turn_id,
            type = excluded.type,
            text = excluded.text,
            data_json = excluded.data_json
        `
      )
      .run(item.id, item.threadId, item.turnId, item.type, item.text, JSON.stringify(item.data), item.createdAt);
    const row = this.db.prepare("SELECT * FROM items WHERE id = ?").get(item.id);
    if (!row) {
      throw new Error(`Failed to create item ${item.id}`);
    }
    return itemFromRow(row as Row);
  }

  upsertItem(item: ThreadItem) {
    this.db
      .prepare(
        `
          INSERT INTO items (id, thread_id, turn_id, type, text, data_json, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            thread_id = excluded.thread_id,
            turn_id = excluded.turn_id,
            type = excluded.type,
            text = excluded.text,
            data_json = excluded.data_json
        `
      )
      .run(item.id, item.threadId, item.turnId, item.type, item.text, JSON.stringify(item.data), item.createdAt);
    return this.getItem(item.id);
  }

  getItem(id: string) {
    const row = this.db.prepare("SELECT * FROM items WHERE id = ?").get(id);
    return row ? itemFromRow(row as Row) : null;
  }

  appendItemText(id: string, delta: string) {
    const row = this.db.prepare("SELECT text FROM items WHERE id = ?").get(id) as Row | undefined;
    if (!row) {
      return null;
    }
    const text = `${scalarString(row.text)}${delta}`;
    this.db.prepare("UPDATE items SET text = ? WHERE id = ?").run(text, id);
    const item = this.db.prepare("SELECT * FROM items WHERE id = ?").get(id);
    return item ? itemFromRow(item as Row) : null;
  }

  listItems(threadId: string) {
    return this.db
      .prepare("SELECT * FROM items WHERE thread_id = ? ORDER BY created_at ASC")
      .all(threadId)
      .map((row) => itemFromRow(row as Row));
  }

  createTask(task: Task) {
    this.db
      .prepare(
        `
          INSERT INTO tasks (id, project_id, thread_id, title, prompt, recipe_id, status, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
      )
      .run(
        task.id,
        task.projectId,
        task.threadId,
        task.title,
        task.prompt,
        task.recipeId,
        task.status,
        task.createdAt,
        task.updatedAt
      );
    return this.getTask(task.id);
  }

  updateTask(id: string, updates: Partial<Pick<Task, "threadId" | "status">>) {
    const existing = this.getTask(id);
    if (!existing) {
      throw new Error(`Task ${id} does not exist`);
    }
    const next = { ...existing, ...updates, updatedAt: nowIso() };
    this.db
      .prepare("UPDATE tasks SET thread_id = ?, status = ?, updated_at = ? WHERE id = ?")
      .run(next.threadId, next.status, next.updatedAt, id);
    return this.getTask(id);
  }

  updateTasksForThread(threadId: string, status: Task["status"]) {
    const now = nowIso();
    this.db
      .prepare("UPDATE tasks SET status = ?, updated_at = ? WHERE thread_id = ?")
      .run(status, now, threadId);
  }

  getTask(id: string) {
    const row = this.db.prepare("SELECT * FROM tasks WHERE id = ?").get(id);
    return row ? taskFromRow(row as Row) : null;
  }

  listTasks() {
    return this.db
      .prepare("SELECT * FROM tasks ORDER BY updated_at DESC")
      .all()
      .map((row) => taskFromRow(row as Row));
  }

  upsertRecipe(recipe: PromptRecipe) {
    this.db
      .prepare(
        `
          INSERT INTO prompt_recipes (id, name, prompt, variables_json, created_at)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            prompt = excluded.prompt,
            variables_json = excluded.variables_json
        `
      )
      .run(recipe.id, recipe.name, recipe.prompt, JSON.stringify(recipe.variables), recipe.createdAt);
  }

  listRecipes() {
    return this.db
      .prepare("SELECT * FROM prompt_recipes ORDER BY name ASC")
      .all()
      .map((row) => recipeFromRow(row as Row));
  }

  createEvalRun(run: EvalRun) {
    this.db
      .prepare(
        `
          INSERT INTO eval_runs (id, task_id, command, status, output, created_at, completed_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `
      )
      .run(run.id, run.taskId, run.command, run.status, run.output, run.createdAt, run.completedAt);
    return run;
  }

  appendEvent(input: Omit<XyzEvent, "id">) {
    const result = this.db
      .prepare("INSERT INTO events (type, thread_id, turn_id, payload_json, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(input.type, input.threadId, input.turnId, JSON.stringify(input.payload), input.createdAt);
    const id = Number(result.lastInsertRowid);
    const row = this.db.prepare("SELECT * FROM events WHERE id = ?").get(id);
    if (!row) {
      throw new Error("Failed to append event");
    }
    return eventFromRow(row as Row);
  }

  getLatestEventId() {
    const row = this.db.prepare("SELECT COALESCE(MAX(id), 0) AS latest_event_id FROM events").get() as Row | undefined;
    return row ? scalarNumber(row.latest_event_id) : 0;
  }

  getLatestEventIdForThread(threadId: string) {
    const row = this.db
      .prepare("SELECT COALESCE(MAX(id), 0) AS latest_event_id FROM events WHERE thread_id = ?")
      .get(threadId) as Row | undefined;
    return row ? scalarNumber(row.latest_event_id) : 0;
  }

  listEvents(afterId = 0, options: EventReplayOptions = {}) {
    const conditions = ["id > ?"];
    const params: Array<string | number> = [afterId];

    if (options.threadId) {
      conditions.push("thread_id = ?");
      params.push(options.threadId);
    }

    if (options.summaryOnly) {
      conditions.push(`type IN (${summaryEventTypes.map(() => "?").join(", ")})`);
      params.push(...summaryEventTypes);
    }

    return this.db
      .prepare(`SELECT * FROM events WHERE ${conditions.join(" AND ")} ORDER BY id ASC`)
      .all(...params)
      .map((row) => eventFromRow(row as Row))
      .filter((event) => !options.summaryOnly || isSummaryEventType(event.type));
  }
}
