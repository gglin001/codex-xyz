import { describe, expect, it } from "vitest";
import { getSessionListModel } from "../src/client/sessionList.js";
import type { ControlThread, Task } from "../src/server/domain.js";

const createdAt = "2026-06-13T00:00:00.000Z";

function thread(overrides: Partial<ControlThread> = {}): ControlThread {
  return {
    id: "thread-1",
    sessionId: "session-1",
    forkedFromId: null,
    projectId: "project-1",
    title: "Implement search",
    preview: "Add a session filter",
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
    title: "Implement search",
    prompt: "Add a session filter",
    recipeId: null,
    status: "running",
    createdAt,
    updatedAt: createdAt,
    ...overrides
  };
}

describe("session list model", () => {
  it("groups running threads separately from history", () => {
    const result = getSessionListModel(
      [
        thread({ id: "running", status: "running" }),
        thread({ id: "idle", status: "idle" }),
        thread({ id: "failed", status: "failed" })
      ],
      [task({ status: "queued" }), task({ id: "task-2", status: "completed" })],
      ""
    );

    expect(result.activeThreads.map((candidate) => candidate.id)).toEqual(["running"]);
    expect(result.otherThreads.map((candidate) => candidate.id)).toEqual(["idle", "failed"]);
    expect(result.queuedTaskCount).toBe(1);
    expect(result.visibleThreadCount).toBe(3);
    expect(result.totalThreadCount).toBe(3);
    expect(result.hasQuery).toBe(false);
  });

  it("filters sessions by title, preview, cwd, status, model, goal, and session id", () => {
    const threads = [
      thread({ id: "title", title: "Runtime console" }),
      thread({ id: "preview", title: "Other", preview: "Investigate stale recovery" }),
      thread({ id: "cwd", title: "Other", cwd: "/work/fork-lab" }),
      thread({ id: "status", title: "Other", status: "failed" }),
      thread({ id: "model", title: "Other", model: "gpt-fast" }),
      thread({ id: "goal", title: "Other", goalObjective: "Ship evidence workspace", goalStatus: "blocked" }),
      thread({ id: "session", title: "Other", sessionId: "session-special" }),
      thread({ id: "miss", title: "Other" })
    ];

    expect(getSessionListModel(threads, [], "runtime").visibleThreadCount).toBe(1);
    expect(getSessionListModel(threads, [], "stale").visibleThreadCount).toBe(1);
    expect(getSessionListModel(threads, [], "fork-lab").visibleThreadCount).toBe(1);
    expect(getSessionListModel(threads, [], "failed").visibleThreadCount).toBe(1);
    expect(getSessionListModel(threads, [], "gpt-fast").visibleThreadCount).toBe(1);
    expect(getSessionListModel(threads, [], "blocked").visibleThreadCount).toBe(1);
    expect(getSessionListModel(threads, [], "special").visibleThreadCount).toBe(1);
  });

  it("keeps active task count independent from the session query", () => {
    const result = getSessionListModel(
      [thread({ id: "visible", title: "Match" }), thread({ id: "hidden", title: "Other" })],
      [task({ status: "running" }), task({ id: "task-2", status: "queued" })],
      "match"
    );

    expect(result.visibleThreadCount).toBe(1);
    expect(result.totalThreadCount).toBe(2);
    expect(result.queuedTaskCount).toBe(2);
    expect(result.hasQuery).toBe(true);
  });
});
