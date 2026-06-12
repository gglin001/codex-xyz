import { describe, expect, it } from "vitest";
import {
  applyEventProjection,
  applyEventProjectionBatch,
  type ClientProjection
} from "../src/client/eventProjection.js";
import type {
  ControlThread,
  DashboardState,
  Project,
  Task,
  ThreadDetail,
  ThreadItem,
  Turn,
  XyzEvent
} from "../src/server/domain.js";

const createdAt = "2026-06-13T00:00:00.000Z";
const updatedAt = "2026-06-13T00:01:00.000Z";

function project(): Project {
  return {
    id: "project-1",
    name: "codex-xyz",
    path: "/tmp/codex-xyz",
    gitRemote: null,
    defaultBranch: null,
    tags: [],
    createdAt,
    updatedAt: createdAt
  };
}

function thread(overrides: Partial<ControlThread> = {}): ControlThread {
  return {
    id: "thread-1",
    sessionId: "session-1",
    forkedFromId: null,
    projectId: "project-1",
    title: "Improve the console",
    preview: "Initial prompt",
    cwd: "/tmp/codex-xyz",
    model: "gpt-test",
    status: "running",
    activeTurnId: "turn-1",
    goalObjective: null,
    goalStatus: null,
    goalTokenBudget: null,
    tokensUsed: 0,
    createdAt,
    updatedAt: createdAt,
    ...overrides
  };
}

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: "task-1",
    projectId: "project-1",
    threadId: "thread-1",
    title: "Improve the console",
    prompt: "Initial prompt",
    recipeId: null,
    status: "running",
    createdAt,
    updatedAt: createdAt,
    ...overrides
  };
}

function turn(overrides: Partial<Turn> = {}): Turn {
  return {
    id: "turn-1",
    threadId: "thread-1",
    status: "running",
    prompt: "Initial prompt",
    startedAt: createdAt,
    completedAt: null,
    durationMs: null,
    ...overrides
  };
}

function item(overrides: Partial<ThreadItem> = {}): ThreadItem {
  return {
    id: "item-1",
    threadId: "thread-1",
    turnId: "turn-1",
    type: "agent",
    text: "Working",
    data: {},
    createdAt,
    ...overrides
  };
}

function state(overrides: Partial<DashboardState> = {}): DashboardState {
  return {
    projects: [project()],
    tasks: [task()],
    threads: [thread()],
    recipes: [],
    ...overrides
  };
}

function projection(): ClientProjection {
  const baseThread = thread();
  return {
    state: state({ threads: [baseThread] }),
    detail: {
      ...baseThread,
      turns: [turn()],
      items: [item()]
    }
  };
}

function event(type: string, payload: Record<string, unknown>, overrides: Partial<XyzEvent> = {}): XyzEvent {
  return {
    id: 1,
    type,
    threadId: "thread-1",
    turnId: "turn-1",
    payload,
    createdAt: updatedAt,
    ...overrides
  };
}

describe("client event projection", () => {
  it("updates transcript items from high-frequency item events without a fallback refresh", () => {
    const updatedItem = item({ text: "Working\nDone" });
    const result = applyEventProjection(projection(), event("item.delta", { item: updatedItem }));

    expect(result.handled).toBe(true);
    expect(result.needsRefresh).toBe(false);
    expect(result.detail?.items).toHaveLength(1);
    expect(result.detail?.items[0].text).toBe("Working\nDone");
  });

  it("projects turn completion into thread, task, and selected detail state", () => {
    const result = applyEventProjection(
      projection(),
      event("turn.status", {
        status: "completed"
      })
    );

    expect(result.handled).toBe(true);
    expect(result.needsRefresh).toBe(false);
    expect(result.state.threads[0]).toMatchObject({
      status: "idle",
      activeTurnId: null,
      updatedAt
    });
    expect(result.state.tasks[0]).toMatchObject({
      status: "completed",
      updatedAt
    });
    expect(result.detail?.turns[0]).toMatchObject({
      status: "completed",
      completedAt: updatedAt
    });
  });

  it("upserts new threads and keeps the low-frequency relationship refresh signal", () => {
    const newThread = thread({
      id: "thread-2",
      sessionId: "session-2",
      activeTurnId: null,
      status: "idle"
    });
    const result = applyEventProjection(
      projection(),
      event("thread.started", { thread: newThread }, { threadId: "thread-2", turnId: null })
    );

    expect(result.handled).toBe(true);
    expect(result.needsRefresh).toBe(true);
    expect(result.state.threads.map((candidate) => candidate.id)).toEqual(["thread-2", "thread-1"]);
  });

  it("applies queued high-frequency events as one ordered projection", () => {
    const result = applyEventProjectionBatch(projection(), [
      event("item.delta", { item: item({ text: "Working." }) }, { id: 2 }),
      event("item.delta", { item: item({ text: "Working. Done." }) }, { id: 3 }),
      event("turn.status", { status: "completed" }, { id: 4 })
    ]);

    expect(result.handled).toBe(true);
    expect(result.needsRefresh).toBe(false);
    expect(result.detail?.items[0].text).toBe("Working. Done.");
    expect(result.detail?.turns[0].status).toBe("completed");
    expect(result.state.threads[0].status).toBe("idle");
  });
});
