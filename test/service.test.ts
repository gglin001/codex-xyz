import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MockCodexAdapter } from "../src/server/codex/mockAdapter.js";
import { ControlService } from "../src/server/service.js";
import { Store } from "../src/server/store.js";

let tempDir: string;
let service: ControlService;

async function waitForEvents() {
  await new Promise((resolve) => setTimeout(resolve, 20));
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "codex-xyz-service-"));
  service = new ControlService(Store.open(join(tempDir, "test.sqlite")), new MockCodexAdapter(0));
  service.seedLocalState({
    cwd: tempDir,
    adapterName: "mock",
    cliVersion: "test"
  });
});

afterEach(async () => {
  await service.close();
  rmSync(tempDir, { recursive: true, force: true });
});

describe("ControlService", () => {
  it("creates a task, thread, turn, transcript items, and completion projection", async () => {
    const project = service.listProjects()[0];
    expect(project).toBeDefined();

    const result = await service.createTask({
      projectId: project.id,
      prompt: "Implement local test support"
    });
    expect(result.thread?.status).toBe("running");

    await waitForEvents();

    const threads = service.listThreads();
    expect(threads).toHaveLength(1);
    expect(threads[0].status).toBe("idle");

    const detail = service.getThreadDetail(threads[0].id);
    expect(detail.turns).toHaveLength(1);
    expect(detail.turns[0].status).toBe("completed");
    expect(detail.items.some((item) => item.type === "agent" && item.text.includes("Mock run started"))).toBe(true);
    expect(service.listTasks()[0].status).toBe("completed");
  });

  it("supports goal, fork, and steer controls", async () => {
    const project = service.listProjects()[0];
    const result = await service.createTask({
      projectId: project.id,
      prompt: "Keep this turn open for steering approval"
    });
    await waitForEvents();

    const threadId = result.thread?.id;
    if (!threadId) {
      throw new Error("Expected created thread id");
    }
    const goal = await service.setGoal(threadId, "Finish the first-version MVP");
    expect(goal.status).toBe("in_progress");

    await service.steerTurn(threadId, "Narrow the response to local testing.");
    expect(service.getThreadDetail(threadId).items.some((item) => item.text.includes("Steer received"))).toBe(true);

    const fork = await service.forkThread(threadId);
    expect(fork.forkedFromId).toBe(threadId);

    const approval = service.listApprovals()[0];
    if (!approval) {
      throw new Error("Expected pending approval");
    }
    await service.resolveApproval(approval.id, true);
    await waitForEvents();
    expect(service.getThreadDetail(threadId).items.some((item) => item.text.includes("Approval accepted"))).toBe(true);
  });
});
