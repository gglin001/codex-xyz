import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MockCodexAdapter } from "../src/server/codex/mockAdapter.js";
import type { DashboardState } from "../src/server/domain.js";
import { createHttpServer } from "../src/server/http.js";
import { ControlService } from "../src/server/service.js";
import { Store } from "../src/server/store.js";

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

beforeEach(async () => {
  tempDir = mkdtempSync(join(tmpdir(), "codex-xyz-http-"));
  service = new ControlService(Store.open(join(tempDir, "test.sqlite")), new MockCodexAdapter(0));
  service.seedLocalState({
    cwd: tempDir,
    adapterName: "mock",
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
    expect(created.thread.id).toMatch(/^thread_/);

    await new Promise((resolve) => setTimeout(resolve, 20));
    const detail = await json<{ items: Array<{ text: string }> }>(`/api/threads/${created.thread.id}`);
    expect(detail.items.map((item) => item.text).join("\n")).toContain("Mock run started");
  });

  it("resolves mock approvals through the API", async () => {
    const state = await json<DashboardState>("/api/state");
    const created = await json<{ thread: { id: string } }>("/api/tasks", {
      method: "POST",
      body: JSON.stringify({
        projectId: state.projects[0].id,
        prompt: "approval required before rm -rf"
      })
    });

    await new Promise((resolve) => setTimeout(resolve, 20));
    const withApproval = await json<DashboardState>("/api/state");
    expect(withApproval.approvals).toHaveLength(1);

    const approval = await json<{ status: string }>(`/api/approvals/${withApproval.approvals[0].id}/resolve`, {
      method: "POST",
      body: JSON.stringify({ approved: true })
    });
    expect(approval.status).toBe("approved");

    await new Promise((resolve) => setTimeout(resolve, 20));
    const detail = await json<{ items: Array<{ text: string }> }>(`/api/threads/${created.thread.id}`);
    expect(detail.items.map((item) => item.text).join("\n")).toContain("Approval accepted");
  });
});
