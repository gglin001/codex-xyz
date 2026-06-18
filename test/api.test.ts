import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type {
  ControlThread,
  DashboardState,
  RuntimeSyncResult,
  TerminalSnapshot,
  ThreadPage
} from "../src/server/domain.js";
import { EventBus } from "../src/server/eventBus.js";
import { handleApiRequest } from "../src/server/api.js";
import { ControlService } from "../src/server/service.js";
import { Store } from "../src/server/store.js";
import { TerminalController, type PtyFactory } from "../src/server/terminal.js";
import { TestCodexAdapter } from "./testCodexAdapter.js";

class FakeTerminalPty {
  readonly pid = 2525;
  process = "fake-terminal";
  handleFlowControl = false;
  readonly emitter = new EventEmitter();
  writes: string[] = [];
  killed = false;
  cols: number;
  rows: number;

  constructor(cols: number, rows: number) {
    this.cols = cols;
    this.rows = rows;
  }

  onData(listener: (data: string) => void) {
    this.emitter.on("data", listener);
    return {
      dispose: () => this.emitter.off("data", listener)
    };
  }

  onExit(listener: (exit: { exitCode: number; signal?: number }) => void) {
    this.emitter.on("exit", listener);
    return {
      dispose: () => this.emitter.off("exit", listener)
    };
  }

  resize(cols: number, rows: number) {
    this.cols = cols;
    this.rows = rows;
  }

  clear() {}

  write(data: string | Buffer) {
    this.writes.push(data.toString());
  }

  kill() {
    this.killed = true;
    this.emitter.emit("exit", { exitCode: 0 });
  }

  pause() {}

  resume() {}

  emitData(data: string) {
    this.emitter.emit("data", data);
  }
}

let tempDir: string;
let service: ControlService;
let testAdapter: TestCodexAdapter;
let terminalPtys: FakeTerminalPty[];

async function apiResponse(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  if (!headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  return (
    (await handleApiRequest(
      service,
      new Request(`http://codex-xyz.test${path}`, {
        ...init,
        headers
      })
    )) ?? Response.json({ error: "Not found" }, { status: 404 })
  );
}

async function json<T>(path: string, init?: RequestInit) {
  const response = await apiResponse(path, init);
  expect(response.ok).toBe(true);
  return (await response.json()) as T;
}

async function noContent(path: string, init?: RequestInit) {
  const response = await apiResponse(path, init);
  expect(response.status).toBe(204);
}

async function firstStreamChunk(path: string, init?: RequestInit) {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort(new Error("Timed out waiting for the first stream chunk"));
  }, 500);
  try {
    const response = await apiResponse(path, {
      ...init,
      signal: controller.signal
    });
    expect(response.ok).toBe(true);
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error("Expected a response body");
    }
    const chunk = await reader.read();
    await reader.cancel();
    expect(chunk.done).toBe(false);
    return {
      response,
      text: new TextDecoder().decode(chunk.value)
    };
  } finally {
    clearTimeout(timeout);
    controller.abort();
  }
}

async function readStreamUntil(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  predicate: (text: string) => boolean,
  label: string
) {
  const decoder = new TextDecoder();
  const deadline = Date.now() + 1_000;
  let text = "";
  while (Date.now() < deadline) {
    const remaining = Math.max(1, deadline - Date.now());
    const timeout = new Promise<ReadableStreamReadResult<Uint8Array>>((_, reject) => {
      setTimeout(() => reject(new Error(`Timed out waiting for ${label}`)), remaining);
    });
    const chunk = await Promise.race([reader.read(), timeout]);
    if (chunk.done) {
      break;
    }
    text += decoder.decode(chunk.value, { stream: true });
    if (predicate(text)) {
      return text;
    }
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function waitFor(assertion: () => boolean | Promise<boolean>, label: string) {
  const deadline = Date.now() + 1_000;
  while (Date.now() < deadline) {
    if (await assertion()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

function threadFixture(index: number, projectId: string): ControlThread {
  const timestamp = new Date(Date.UTC(2026, 5, 13, 0, 0, index)).toISOString();
  return {
    id: `thread-${String(index).padStart(3, "0")}`,
    sessionId: `session-${String(index).padStart(3, "0")}`,
    forkedFromId: null,
    projectId,
    title: `Session ${index}`,
    preview: `Preview ${index}`,
    cwd: tempDir,
    model: "test-codex",
    status: "idle",
    activeTurnId: null,
    goalObjective: null,
    goalStatus: null,
    goalTokenBudget: null,
    tokensUsed: 0,
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "codex-xyz-api-"));
  terminalPtys = [];
  const ptyFactory: PtyFactory = (_file, _args, options) => {
    const fake = new FakeTerminalPty(options.cols ?? 80, options.rows ?? 24);
    terminalPtys.push(fake);
    return fake;
  };
  const terminal = new TerminalController({
    cwd: tempDir,
    command: { file: "fake-terminal", args: [] },
    ptyFactory
  });
  testAdapter = new TestCodexAdapter();
  service = new ControlService(Store.open(join(tempDir, "test.sqlite")), testAdapter, new EventBus(), terminal);
  service.seedLocalState({
    cwd: tempDir,
    adapterName: "test",
    cliVersion: "test"
  });
});

afterEach(async () => {
  await service.close();
  rmSync(tempDir, { recursive: true, force: true });
});

describe("Next API routes", () => {
  it("serves dashboard state and can create a local task", async () => {
    const state = await json<DashboardState>("/api/state");
    expect(state.projects).toHaveLength(1);
    expect(state.latestEventId).toBe(0);

    const created = await json<{ thread: { id: string } }>("/api/tasks", {
      method: "POST",
      body: JSON.stringify({
        projectId: state.projects[0].id,
        prompt: "Run the local test command"
      })
    });
    expect(created.thread.id).toMatch(/^[0-9a-f-]{36}$/);

    await new Promise((resolve) => setTimeout(resolve, 20));
    const nextState = await json<DashboardState>("/api/state");
    const detail = await json<{ items: Array<{ text: string }>; latestEventId: number }>(
      `/api/threads/${created.thread.id}`
    );
    expect(nextState.latestEventId).toBeGreaterThan(0);
    expect(detail.latestEventId).toBeGreaterThan(0);
    expect(detail.items.map((item) => item.text).join("\n")).toContain("Test run started");
  });

  it("creates a goal session from a local task request", async () => {
    const state = await json<DashboardState>("/api/state");
    const created = await json<{
      goal: { objective: string; status: string } | null;
      thread: { id: string; goalObjective: string | null; goalStatus: string | null };
      turn: { threadId: string; prompt: string; status: string } | null;
    }>("/api/tasks", {
      method: "POST",
      body: JSON.stringify({
        projectId: state.projects[0].id,
        prompt: "Finish the local goal workflow",
        goalMode: true
      })
    });

    expect(created.turn).toMatchObject({
      threadId: created.thread.id,
      prompt: "",
      status: "running"
    });
    expect(created.goal?.objective).toBe("Finish the local goal workflow");
    expect(created.goal?.status).toBe("in_progress");
    expect(created.thread.goalObjective).toBe("Finish the local goal workflow");
    expect(created.thread.goalStatus).toBe("in_progress");

    await new Promise((resolve) => setTimeout(resolve, 20));
    const detail = await json<{ goalObjective: string | null; turns: Array<{ prompt: string; status: string }> }>(
      `/api/threads/${created.thread.id}`
    );
    expect(detail.goalObjective).toBe("Finish the local goal workflow");
    expect(detail.turns).toHaveLength(1);
    expect(detail.turns[0]).toMatchObject({
      prompt: "",
      status: "completed"
    });
  });

  it("paginates large thread sets while keeping small state snapshots complete", async () => {
    const project = service.listProjects()[0];
    for (let index = 1; index <= 55; index += 1) {
      service.store.createThread(threadFixture(index, project.id));
    }

    const state = await json<DashboardState>("/api/state");
    expect(state.threads).toHaveLength(50);
    expect(state.threadTotalCount).toBe(55);
    expect(state.threadNextOffset).toBe(50);
    expect(state.threadHasMore).toBe(true);
    expect(state.threads[0].id).toBe("thread-055");

    const page = await json<ThreadPage>("/api/threads?limit=50&offset=50");
    expect(page.threads).toHaveLength(5);
    expect(page.totalCount).toBe(55);
    expect(page.nextOffset).toBe(55);
    expect(page.hasMore).toBe(false);
    expect(page.threads.map((thread) => thread.id)).toEqual([
      "thread-005",
      "thread-004",
      "thread-003",
      "thread-002",
      "thread-001"
    ]);
  });

  it("opens idle thread event streams with an immediate SSE frame", async () => {
    const project = service.listProjects()[0];
    const thread = threadFixture(1, project.id);
    service.store.createThread(thread);

    const { response, text } = await firstStreamChunk(`/api/threads/${thread.id}/events?after=999999`);

    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(text).toBe(": connected\n\n");
  });

  it("creates a project from a working directory path", async () => {
    const projectDir = join(tempDir, "nested-project");
    mkdirSync(projectDir);

    const project = await json<{ id: string; name: string; path: string }>("/api/projects", {
      method: "POST",
      body: JSON.stringify({
        path: `${projectDir}/`
      })
    });
    expect(project.name).toBe("nested-project");
    expect(project.path).toBe(projectDir);

    const duplicate = await json<{ id: string; path: string }>("/api/projects", {
      method: "POST",
      body: JSON.stringify({
        path: projectDir
      })
    });
    expect(duplicate.id).toBe(project.id);
    expect(duplicate.path).toBe(projectDir);
  });

  it("runs high-risk prompts without approvals in yolo mode", async () => {
    const state = await json<DashboardState>("/api/state");
    const created = await json<{ thread: { id: string } }>("/api/tasks", {
      method: "POST",
      body: JSON.stringify({
        projectId: state.projects[0].id,
        prompt: "approval required before rm -rf"
      })
    });

    await new Promise((resolve) => setTimeout(resolve, 20));
    const detail = await json<{ items: Array<{ text: string }> }>(`/api/threads/${created.thread.id}`);
    expect(detail.items.map((item) => item.text).join("\n")).toContain("Test run started");
  });

  it("controls a running session through the API", async () => {
    const state = await json<DashboardState>("/api/state");
    const created = await json<{ thread: { id: string } }>("/api/tasks", {
      method: "POST",
      body: JSON.stringify({
        projectId: state.projects[0].id,
        prompt: "Keep this turn open for steering"
      })
    });

    await new Promise((resolve) => setTimeout(resolve, 20));
    const renamed = await json<{ title: string }>(`/api/threads/${created.thread.id}/name`, {
      method: "PUT",
      body: JSON.stringify({
        title: "HTTP controlled session"
      })
    });
    expect(renamed.title).toBe("HTTP controlled session");

    await noContent(`/api/threads/${created.thread.id}/steer`, {
      method: "POST",
      body: JSON.stringify({
        prompt: "Prefer the compact path."
      })
    });

    const interrupted = await json<{ status: string }>(`/api/threads/${created.thread.id}/interrupt`, {
      method: "POST",
      body: JSON.stringify({})
    });
    expect(interrupted.status).toBe("interrupted");

    const resumed = await json<{ id: string; status: string }>(`/api/threads/${created.thread.id}/resume`, {
      method: "POST",
      body: JSON.stringify({})
    });
    expect(resumed).toMatchObject({
      id: created.thread.id,
      status: "idle"
    });

    const goalStart = await json<{ goal: { tokenBudget: number | null }; turn: { threadId: string; prompt: string } }>(
      `/api/threads/${created.thread.id}/goal`,
      {
        method: "PUT",
        body: JSON.stringify({
          objective: "Finish the control surface",
          tokenBudget: 2048
        })
      }
    );
    expect(goalStart.goal.tokenBudget).toBe(2048);
    expect(goalStart.turn).toMatchObject({
      threadId: created.thread.id,
      prompt: ""
    });

    const pausedGoal = await json<{ goal: { status: string }; thread: { goalStatus: string | null } }>(
      `/api/threads/${created.thread.id}/goal/status`,
      {
        method: "PUT",
        body: JSON.stringify({
          status: "paused"
        })
      }
    );
    expect(pausedGoal.goal.status).toBe("paused");
    expect(pausedGoal.thread.goalStatus).toBe("paused");

    const completedGoal = await json<{ goal: { status: string }; thread: { goalStatus: string | null } }>(
      `/api/threads/${created.thread.id}/goal/status`,
      {
        method: "PUT",
        body: JSON.stringify({
          status: "complete"
        })
      }
    );
    expect(completedGoal.goal.status).toBe("complete");
    expect(completedGoal.thread.goalStatus).toBe("complete");

    const clearedGoal = await json<{ goalStatus: string | null }>(`/api/threads/${created.thread.id}/goal`, {
      method: "DELETE"
    });
    expect(clearedGoal.goalStatus).toBe("cleared");

    const fork = await json<{ id: string; forkedFromId: string | null }>(`/api/threads/${created.thread.id}/fork`, {
      method: "POST",
      body: JSON.stringify({})
    });
    expect(fork.forkedFromId).toBe(created.thread.id);
  });

  it("queues prompts through the API and drains them after the active turn", async () => {
    const state = await json<DashboardState>("/api/state");
    const created = await json<{ thread: { id: string } }>("/api/tasks", {
      method: "POST",
      body: JSON.stringify({
        projectId: state.projects[0].id,
        prompt: "Keep this turn open for queue mode"
      })
    });

    await new Promise((resolve) => setTimeout(resolve, 20));
    const queued = await json<Array<{ prompt: string }>>(`/api/threads/${created.thread.id}/queue`, {
      method: "POST",
      body: JSON.stringify({
        prompt: "Run after the current turn."
      })
    });
    expect(queued.map((prompt) => prompt.prompt)).toEqual(["Run after the current turn."]);

    const detailWithQueue = await json<{ queuedPrompts: Array<{ prompt: string }> }>(
      `/api/threads/${created.thread.id}`
    );
    expect(detailWithQueue.queuedPrompts.map((prompt) => prompt.prompt)).toEqual(["Run after the current turn."]);

    testAdapter.completeActiveTurn(created.thread.id);
    await waitFor(async () => {
      const detail = await json<{ queuedPrompts: unknown[]; items: Array<{ text: string }> }>(
        `/api/threads/${created.thread.id}`
      );
      return (
        detail.queuedPrompts.length === 0 &&
        detail.items.some((item) => item.text.includes("Prompt preview: Run after the current turn."))
      );
    }, "queued prompt to drain");
  });

  it("syncs loaded session runtime status through the API", async () => {
    const state = await json<DashboardState>("/api/state");
    const created = await json<{ thread: { id: string }; turn: { id: string } }>("/api/tasks", {
      method: "POST",
      body: JSON.stringify({
        projectId: state.projects[0].id,
        prompt: "Keep this turn open for runtime sync"
      })
    });

    await new Promise((resolve) => setTimeout(resolve, 20));
    testAdapter.dropActiveTurn(created.thread.id);

    const sync = await json<RuntimeSyncResult>("/api/threads/runtime-sync", {
      method: "POST",
      body: JSON.stringify({
        threadIds: [created.thread.id]
      })
    });
    expect(sync).toMatchObject({
      checkedThreadCount: 1,
      updatedThreadCount: 1,
      warningCount: 1,
      errorCount: 0
    });

    const detail = await json<{
      status: string;
      activeTurnId: string | null;
      turns: Array<{ id: string; status: string }>;
    }>(`/api/threads/${created.thread.id}`);
    expect(detail).toMatchObject({
      status: "idle",
      activeTurnId: null
    });
    expect(detail.turns.find((turn) => turn.id === created.turn.id)?.status).toBe("interrupted");
  });

  it("streams terminal output over SSE and controls input over POST routes", async () => {
    const started = await json<TerminalSnapshot>("/api/terminal/start", {
      method: "POST",
      body: JSON.stringify({
        cols: 80,
        rows: 24
      })
    });
    const controller = new AbortController();
    const response = await apiResponse(`/api/terminal/events?after=${started.sequence}`, {
      signal: controller.signal
    });
    expect(response.ok).toBe(true);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error("Expected a terminal event stream");
    }

    try {
      const connected = await readStreamUntil(reader, (text) => text.includes(": connected\n\n"), "SSE connection");
      expect(connected).toContain(": connected\n\n");

      terminalPtys[0].emitData("hello over sse\r\n");
      const output = await readStreamUntil(
        reader,
        (text) => text.includes("terminal.output") && text.includes("hello over sse"),
        "terminal SSE output"
      );
      expect(output).toContain("terminal.output");
      expect(output).toContain("hello over sse");

      await noContent("/api/terminal/input", {
        method: "POST",
        body: JSON.stringify({ data: "abc" })
      });
      await waitFor(() => terminalPtys[0].writes.includes("abc"), "terminal input");

      const resized = await json<TerminalSnapshot>("/api/terminal/resize", {
        method: "POST",
        body: JSON.stringify({ cols: 120, rows: 40 })
      });
      expect(resized.cols).toBe(120);
      expect(resized.rows).toBe(40);
      expect(terminalPtys[0].cols).toBe(120);
      expect(terminalPtys[0].rows).toBe(40);
    } finally {
      await reader.cancel();
      controller.abort();
    }
  });
});
