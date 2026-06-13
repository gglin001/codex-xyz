import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  AdapterThreadNotFoundError,
  type AdapterEventHandler,
  type AdapterGoal,
  type AdapterThread,
  type AdapterTurn,
  type CodexAdapter,
  type ForkThreadInput,
  type RunShellCommandInput,
  type ResumeThreadInput,
  type StartThreadInput,
  type StartTurnAdapterInput
} from "../src/server/codex/adapter.js";
import { ControlService } from "../src/server/service.js";
import { Store } from "../src/server/store.js";
import { TestCodexAdapter } from "./testCodexAdapter.js";

let tempDir: string;
let service: ControlService;

async function waitForEvents() {
  await new Promise((resolve) => setTimeout(resolve, 20));
}

class VolatileCodexAdapter implements CodexAdapter {
  readonly name = "volatile";
  readonly version = "test";
  private handler: AdapterEventHandler = () => {};
  private readonly threads = new Map<string, AdapterThread>();
  private readonly timers = new Set<NodeJS.Timeout>();
  private nextThread = 1;
  private nextTurn = 1;

  onEvent(handler: AdapterEventHandler) {
    this.handler = handler;
  }

  forgetThread(threadId: string) {
    this.threads.delete(threadId);
  }

  async startThread(input: StartThreadInput): Promise<AdapterThread> {
    const id = `volatile_thread_${this.nextThread++}`;
    const thread: AdapterThread = {
      id,
      sessionId: id,
      forkedFromId: null,
      preview: input.promptPreview,
      cwd: input.cwd,
      model: input.model ?? "volatile-model"
    };
    this.threads.set(id, thread);
    return thread;
  }

  async resumeThread(input: ResumeThreadInput): Promise<AdapterThread> {
    return this.requireThread(input.threadId);
  }

  async startTurn(input: StartTurnAdapterInput): Promise<AdapterTurn> {
    this.requireThread(input.threadId);
    const turn: AdapterTurn = {
      id: `volatile_turn_${this.nextTurn++}`,
      status: "running"
    };
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      this.handler({
        type: "turn.status",
        threadId: input.threadId,
        turnId: turn.id,
        status: "completed",
        durationMs: 0
      });
    }, 0);
    this.timers.add(timer);
    return turn;
  }

  async runShellCommand(input: RunShellCommandInput): Promise<AdapterTurn> {
    return this.startTurn({
      threadId: input.threadId,
      prompt: `!${input.command}`
    });
  }

  async steerTurn(input: { threadId: string }) {
    this.requireThread(input.threadId);
  }

  async interruptTurn(input: { threadId: string }) {
    this.requireThread(input.threadId);
  }

  async forkThread(input: ForkThreadInput): Promise<AdapterThread> {
    const source = this.requireThread(input.sourceThreadId);
    const fork = await this.startThread({
      cwd: input.cwd,
      model: input.model ?? source.model,
      promptPreview: `Fork of ${source.preview}`
    });
    return {
      ...fork,
      sessionId: source.sessionId,
      forkedFromId: source.id
    };
  }

  async renameThread(input: { threadId: string }) {
    this.requireThread(input.threadId);
  }

  async setGoal(input: { threadId: string; objective: string; tokenBudget?: number | null }): Promise<AdapterGoal> {
    this.requireThread(input.threadId);
    return {
      objective: input.objective,
      status: "in_progress",
      tokenBudget: input.tokenBudget ?? null,
      tokensUsed: 0
    };
  }

  async getGoal(threadId: string) {
    this.requireThread(threadId);
    return null;
  }

  async clearGoal(threadId: string) {
    this.requireThread(threadId);
  }

  async close() {
    for (const timer of this.timers) {
      clearTimeout(timer);
    }
    this.timers.clear();
  }

  private requireThread(threadId: string) {
    const thread = this.threads.get(threadId);
    if (!thread) {
      throw new AdapterThreadNotFoundError(threadId, `thread not found: ${threadId}`);
    }
    return thread;
  }
}

class EagerEventCodexAdapter implements CodexAdapter {
  readonly name = "eager";
  readonly version = "test";
  private handler: AdapterEventHandler = () => {};
  private readonly threads = new Map<string, AdapterThread>();
  private nextThread = 1;
  private nextTurn = 1;

  onEvent(handler: AdapterEventHandler) {
    this.handler = handler;
  }

  async startThread(input: StartThreadInput): Promise<AdapterThread> {
    const id = `eager_thread_${this.nextThread++}`;
    const thread: AdapterThread = {
      id,
      sessionId: id,
      forkedFromId: null,
      preview: input.promptPreview,
      cwd: input.cwd,
      model: input.model ?? "eager-model"
    };
    this.threads.set(id, thread);
    return thread;
  }

  async resumeThread(input: ResumeThreadInput): Promise<AdapterThread> {
    return this.requireThread(input.threadId);
  }

  async startTurn(input: StartTurnAdapterInput): Promise<AdapterTurn> {
    this.requireThread(input.threadId);
    const turn: AdapterTurn = {
      id: `eager_turn_${this.nextTurn++}`,
      status: "running"
    };
    const answerId = `eager_item_${turn.id}`;
    this.handler({
      type: "item.created",
      threadId: input.threadId,
      turnId: turn.id,
      itemId: answerId,
      itemType: "agent",
      text: "",
      data: { adapter: "eager" }
    });
    this.handler({
      type: "item.delta",
      threadId: input.threadId,
      turnId: turn.id,
      itemId: answerId,
      delta: `Answered before return: ${input.prompt}`
    });
    this.handler({
      type: "turn.status",
      threadId: input.threadId,
      turnId: turn.id,
      status: "completed",
      durationMs: 1
    });
    return turn;
  }

  async runShellCommand(input: RunShellCommandInput): Promise<AdapterTurn> {
    return this.startTurn({
      threadId: input.threadId,
      prompt: `!${input.command}`,
      model: null
    });
  }

  async steerTurn(input: { threadId: string }) {
    this.requireThread(input.threadId);
  }

  async interruptTurn(input: { threadId: string }) {
    this.requireThread(input.threadId);
  }

  async forkThread(input: ForkThreadInput): Promise<AdapterThread> {
    const source = this.requireThread(input.sourceThreadId);
    const id = `eager_thread_${this.nextThread++}`;
    const thread: AdapterThread = {
      id,
      sessionId: source.sessionId,
      forkedFromId: source.id,
      preview: `Fork of ${source.preview}`,
      cwd: input.cwd,
      model: input.model ?? source.model
    };
    this.threads.set(id, thread);
    return thread;
  }

  async renameThread(input: { threadId: string; title: string }) {
    const thread = this.requireThread(input.threadId);
    thread.preview = input.title;
  }

  async setGoal(input: { threadId: string; objective: string; tokenBudget?: number | null }): Promise<AdapterGoal> {
    this.requireThread(input.threadId);
    return {
      objective: input.objective,
      status: "in_progress",
      tokenBudget: input.tokenBudget ?? null,
      tokensUsed: 0
    };
  }

  async getGoal(threadId: string) {
    this.requireThread(threadId);
    return null;
  }

  async clearGoal(threadId: string) {
    this.requireThread(threadId);
  }

  async close() {
    this.threads.clear();
  }

  private requireThread(threadId: string) {
    const thread = this.threads.get(threadId);
    if (!thread) {
      throw new AdapterThreadNotFoundError(threadId, `thread not found: ${threadId}`);
    }
    return thread;
  }
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "codex-xyz-service-"));
  service = new ControlService(Store.open(join(tempDir, "test.sqlite")), new TestCodexAdapter());
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
    expect(detail.items.some((item) => item.type === "agent" && item.text.includes("Test run started"))).toBe(true);
    expect(service.listTasks()[0].status).toBe("completed");
  });

  it("keeps dashboard snapshots and summary event replay separate from transcript detail", async () => {
    const project = service.listProjects()[0];
    const result = await service.createTask({
      projectId: project.id,
      prompt: "Exercise summary replay"
    });
    await waitForEvents();

    const threadId = result.thread?.id;
    if (!threadId) {
      throw new Error("Expected created thread id");
    }

    const dashboard = service.dashboard();
    const detail = service.getThreadDetail(threadId);
    const fullReplay = service.replayEvents(0, { threadId });
    const summaryReplay = service.replayEvents(0, { summaryOnly: true });

    expect(dashboard.latestEventId).toBeGreaterThan(0);
    expect(dashboard.threads[0]).not.toHaveProperty("items");
    expect(detail.latestEventId).toBeGreaterThan(0);
    expect(detail.items.some((item) => item.text.includes("Test run started"))).toBe(true);
    expect(fullReplay.some((event) => event.type.startsWith("item."))).toBe(true);
    expect(summaryReplay.some((event) => event.type.startsWith("item."))).toBe(false);
    expect(summaryReplay.some((event) => event.type === "adapter.raw")).toBe(false);
  });

  it("records items that arrive before the adapter startTurn call returns", async () => {
    await service.close();
    const adapter = new EagerEventCodexAdapter();
    service = new ControlService(Store.open(join(tempDir, "eager.sqlite")), adapter);
    service.seedLocalState({
      cwd: tempDir,
      adapterName: adapter.name,
      cliVersion: adapter.version
    });

    const project = service.listProjects()[0];
    const result = await service.createTask({
      projectId: project.id,
      prompt: "Prompt with eager adapter events"
    });
    const threadId = result.thread?.id;
    if (!threadId) {
      throw new Error("Expected created thread id");
    }

    const detail = service.getThreadDetail(threadId);
    expect(result.turn.status).toBe("completed");
    expect(detail.status).toBe("idle");
    expect(detail.turns).toHaveLength(1);
    expect(detail.turns[0].prompt).toBe("Prompt with eager adapter events");
    expect(detail.turns[0].status).toBe("completed");
    expect(detail.items.some((item) => item.text.includes("Answered before return"))).toBe(true);
    expect(service.listTasks()[0].status).toBe("completed");
  });

  it("runs bang-prefixed prompts as shell commands instead of model turns", async () => {
    const project = service.listProjects()[0];
    const result = await service.createTask({
      projectId: project.id,
      prompt: "!pwd"
    });
    await waitForEvents();

    const threadId = result.thread?.id;
    if (!threadId) {
      throw new Error("Expected created thread id");
    }

    const detail = service.getThreadDetail(threadId);
    expect(detail.turns).toHaveLength(1);
    expect(detail.turns[0].prompt).toBe("!pwd");
    expect(detail.turns[0].status).toBe("completed");
    expect(detail.items.some((item) => item.type === "command" && item.text.includes(`$ pwd\n${tempDir}`))).toBe(true);
    expect(detail.items.some((item) => item.type === "agent" && item.text.includes("Prompt preview: !pwd"))).toBe(false);
    expect(service.listTasks()[0].status).toBe("completed");
  });

  it("runs bang-prefixed prompts on the active turn when one is running", async () => {
    const project = service.listProjects()[0];
    const result = await service.createTask({
      projectId: project.id,
      prompt: "Keep this turn open for steering approval"
    });
    await waitForEvents();

    const threadId = result.thread?.id;
    const turnId = result.turn.id;
    if (!threadId) {
      throw new Error("Expected created thread id");
    }

    const shellTurn = await service.startTurn({
      threadId,
      prompt: "   !pwd"
    });
    await waitForEvents();

    const detail = service.getThreadDetail(threadId);
    expect(shellTurn.id).toBe(turnId);
    expect(detail.status).toBe("running");
    expect(detail.items.some((item) => item.type === "command" && item.turnId === turnId && item.text.includes(tempDir))).toBe(true);
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
    const renamed = await service.renameThread({
      threadId,
      title: "Steering session"
    });
    expect(renamed?.title).toBe("Steering session");

    const goal = await service.setGoal({
      threadId,
      objective: "Finish the first-version MVP",
      tokenBudget: 1200
    });
    expect(goal.status).toBe("in_progress");
    expect(goal.tokenBudget).toBe(1200);

    await service.steerTurn(threadId, "Narrow the response to local testing.");
    expect(service.getThreadDetail(threadId).items.some((item) => item.text.includes("Steer received"))).toBe(true);

    const fork = await service.forkThread(threadId);
    expect(fork.forkedFromId).toBe(threadId);
  });

  it("continues on a new thread when the persisted runtime thread is missing", async () => {
    await service.close();
    const adapter = new VolatileCodexAdapter();
    service = new ControlService(Store.open(join(tempDir, "volatile.sqlite")), adapter);
    service.seedLocalState({
      cwd: tempDir,
      adapterName: adapter.name,
      cliVersion: adapter.version
    });

    const project = service.listProjects()[0];
    const result = await service.createTask({
      projectId: project.id,
      prompt: "Initial runtime thread"
    });
    await waitForEvents();

    const oldThreadId = result.thread?.id;
    if (!oldThreadId) {
      throw new Error("Expected created thread id");
    }
    expect(service.listTasks().find((task) => task.threadId === oldThreadId)?.status).toBe("completed");

    adapter.forgetThread(oldThreadId);
    const turn = await service.startTurn({
      threadId: oldThreadId,
      prompt: "Prompt after app-server restart"
    });
    await waitForEvents();

    expect(turn.threadId).not.toBe(oldThreadId);
    expect(service.getThreadDetail(oldThreadId).status).toBe("stale");
    expect(service.getThreadDetail(turn.threadId).forkedFromId).toBe(oldThreadId);
    expect(service.listTasks().find((task) => task.threadId === oldThreadId)?.status).toBe("completed");
  });
});
