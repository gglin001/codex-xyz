import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DashboardState } from "../src/server/domain.js";
import { createHttpServer } from "../src/server/http.js";
import { ControlService } from "../src/server/service.js";
import { Store } from "../src/server/store.js";
import { TestCodexAdapter } from "./testCodexAdapter.js";

let tempDir: string;
let service: ControlService;
let baseUrl: string;
let server: ReturnType<typeof createHttpServer>;

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

beforeEach(async () => {
  tempDir = mkdtempSync(join(tmpdir(), "codex-xyz-http-"));
  service = new ControlService(Store.open(join(tempDir, "test.sqlite")), new TestCodexAdapter());
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

    const created = await json<{ thread: { id: string } }>("/api/tasks", {
      method: "POST",
      body: JSON.stringify({
        projectId: state.projects[0].id,
        prompt: "Run the local test command"
      })
    });
    expect(created.thread.id).toMatch(/^[0-9a-f-]{36}$/);

    await new Promise((resolve) => setTimeout(resolve, 20));
    const detail = await json<{ items: Array<{ text: string }> }>(`/api/threads/${created.thread.id}`);
    expect(detail.items.map((item) => item.text).join("\n")).toContain("Test run started");
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
});
