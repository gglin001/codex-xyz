import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AddressInfo } from "node:net";
import WebSocket from "ws";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ControlThread, DashboardState, TerminalEvent, TerminalSnapshot, ThreadPage } from "../src/server/domain.js";
import { EventBus } from "../src/server/eventBus.js";
import { createHttpServer } from "../src/server/http.js";
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
let baseUrl: string;
let server: ReturnType<typeof createHttpServer>;
let terminalPtys: FakeTerminalPty[];

async function listen() {
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
}

async function json<T>(path: string, init?: RequestInit) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...init?.headers
    }
  });
  expect(response.ok).toBe(true);
  return (await response.json()) as T;
}

async function noContent(path: string, init?: RequestInit) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...init?.headers
    }
  });
  expect(response.status).toBe(204);
}

async function waitFor(assertion: () => boolean, label: string) {
  const deadline = Date.now() + 1_000;
  while (Date.now() < deadline) {
    if (assertion()) {
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

beforeEach(async () => {
  tempDir = mkdtempSync(join(tmpdir(), "codex-xyz-http-"));
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
  service = new ControlService(Store.open(join(tempDir, "test.sqlite")), new TestCodexAdapter(), new EventBus(), terminal);
  service.seedLocalState({
    cwd: tempDir,
    adapterName: "test",
    cliVersion: "test"
  });
  server = createHttpServer(service);
  await listen();
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await service.close();
  rmSync(tempDir, { recursive: true, force: true });
});

describe("HTTP API", () => {
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
    const detail = await json<{ items: Array<{ text: string }>; latestEventId: number }>(`/api/threads/${created.thread.id}`);
    expect(nextState.latestEventId).toBeGreaterThan(0);
    expect(detail.latestEventId).toBeGreaterThan(0);
    expect(detail.items.map((item) => item.text).join("\n")).toContain("Test run started");
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

  it("allows any configured CORS origin alias", async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    server = createHttpServer(service, {
      corsOrigins: ["http://0.0.0.0:1123", "http://127.0.0.1:1123"]
    });
    await listen();

    const response = await fetch(`${baseUrl}/api/state`, {
      headers: {
        origin: "http://127.0.0.1:1123"
      }
    });

    expect(response.ok).toBe(true);
    expect(response.headers.get("access-control-allow-origin")).toBe("http://127.0.0.1:1123");
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

  it("controls a running session through the HTTP API", async () => {
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

    const goal = await json<{ tokenBudget: number | null }>(`/api/threads/${created.thread.id}/goal`, {
      method: "PUT",
      body: JSON.stringify({
        objective: "Finish the control surface",
        tokenBudget: 2048
      })
    });
    expect(goal.tokenBudget).toBe(2048);

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

    const fork = await json<{ id: string; forkedFromId: string | null }>(`/api/threads/${created.thread.id}/fork`, {
      method: "POST",
      body: JSON.stringify({})
    });
    expect(fork.forkedFromId).toBe(created.thread.id);
  });

  it("streams terminal output and input over websocket", async () => {
    const started = await json<TerminalSnapshot>("/api/terminal/start", {
      method: "POST",
      body: JSON.stringify({
        cols: 80,
        rows: 24
      })
    });
    const socket = new WebSocket(`${baseUrl.replace(/^http/, "ws")}/api/terminal/ws?after=${started.sequence}`);
    const events: TerminalEvent[] = [];
    socket.on("message", (data) => {
      events.push(JSON.parse(data.toString()) as TerminalEvent);
    });
    await new Promise<void>((resolve, reject) => {
      socket.once("open", resolve);
      socket.once("error", reject);
    });

    terminalPtys[0].emitData("hello over ws\r\n");
    await waitFor(
      () => events.some((event) => event.type === "terminal.output" && event.data.includes("hello over ws")),
      "terminal websocket output"
    );

    socket.send(JSON.stringify({ type: "terminal.input", data: "abc" }));
    await waitFor(() => terminalPtys[0].writes.includes("abc"), "terminal websocket input");

    socket.send(JSON.stringify({ type: "terminal.resize", cols: 120, rows: 40 }));
    await waitFor(() => terminalPtys[0].cols === 120 && terminalPtys[0].rows === 40, "terminal websocket resize");

    socket.close();
    await new Promise<void>((resolve) => socket.once("close", () => resolve()));
  });
});
