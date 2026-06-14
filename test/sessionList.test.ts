import { describe, expect, it } from "vitest";
import { getSessionListModel, selectionTouchesThreadGroup } from "../src/client/sessionList.js";
import type { ControlThread, RuntimeSyncIssue, Task } from "../src/server/domain.js";

const createdAt = "2026-06-13T00:00:00.000Z";
const early = "2026-06-13T00:01:00.000Z";
const middle = "2026-06-13T00:02:00.000Z";
const late = "2026-06-13T00:03:00.000Z";

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

function runtimeIssue(overrides: Partial<RuntimeSyncIssue> = {}): RuntimeSyncIssue {
  return {
    threadId: "thread-1",
    title: "Implement search",
    localStatus: "idle",
    runtimeStatus: "stale",
    severity: "error",
    message: "Session is not loaded by Codex and could not be resumed.",
    ...overrides
  };
}

describe("session list model", () => {
  it("detects whether a selection change touches a visible group", () => {
    const threads = [thread({ id: "alpha" }), thread({ id: "beta" })];

    expect(selectionTouchesThreadGroup(threads, "alpha", "alpha")).toBe(false);
    expect(selectionTouchesThreadGroup(threads, null, "alpha")).toBe(true);
    expect(selectionTouchesThreadGroup(threads, "beta", "outside")).toBe(true);
    expect(selectionTouchesThreadGroup(threads, "outside-a", "outside-b")).toBe(false);
    expect(selectionTouchesThreadGroup(threads, null, "outside")).toBe(false);
  });

  it("keeps visible sessions in a single updated-time ordered list", () => {
    const result = getSessionListModel(
      [
        thread({ id: "running", status: "running", updatedAt: early }),
        thread({ id: "idle", status: "idle", updatedAt: late }),
        thread({ id: "failed", status: "failed", updatedAt: middle }),
        thread({ id: "interrupted", status: "interrupted", updatedAt: createdAt }),
        thread({ id: "stale", status: "stale", updatedAt: createdAt }),
        thread({
          id: "blocked-goal",
          status: "idle",
          goalStatus: "blocked",
          goalObjective: "Finish review",
          updatedAt: createdAt
        })
      ],
      [task({ status: "queued" }), task({ id: "task-2", status: "completed" })],
      ""
    );

    expect(result.threads.map((candidate) => candidate.id)).toEqual([
      "idle",
      "failed",
      "running",
      "interrupted",
      "stale",
      "blocked-goal"
    ]);
    expect(result.queuedTaskCount).toBe(1);
    expect(result.visibleThreadCount).toBe(6);
    expect(result.totalThreadCount).toBe(6);
    expect(result.hasQuery).toBe(false);
  });

  it("keeps runtime sync issues searchable without changing status-based position", () => {
    const issues = new Map([
      ["idle-drift", runtimeIssue({ threadId: "idle-drift", localStatus: "idle", severity: "warning", runtimeStatus: "idle" })],
      ["running-drift", runtimeIssue({ threadId: "running-drift", localStatus: "running", runtimeStatus: "running" })]
    ]);
    const result = getSessionListModel(
      [
        thread({ id: "running", status: "running" }),
        thread({ id: "idle-drift", status: "idle", activeTurnId: null }),
        thread({ id: "running-drift", status: "running" }),
        thread({ id: "idle", status: "idle", activeTurnId: null })
      ],
      [],
      "",
      {
        runtimeIssuesByThreadId: issues
      }
    );

    expect(result.threads.map((candidate) => candidate.id)).toEqual([
      "running",
      "idle-drift",
      "running-drift",
      "idle"
    ]);
    expect(getSessionListModel(result.threads, [], "not loaded", { runtimeIssuesByThreadId: issues }).visibleThreadCount).toBe(2);
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

  it("keeps a single list after filtering across statuses", () => {
    const result = getSessionListModel(
      [
        thread({ id: "visible-attention", title: "Match", status: "failed" }),
        thread({ id: "visible-history", title: "Match", status: "idle" }),
        thread({ id: "hidden-attention", title: "Other", status: "failed" })
      ],
      [],
      "match"
    );

    expect(result.threads.map((candidate) => candidate.id)).toEqual(["visible-attention", "visible-history"]);
    expect(result.visibleThreadCount).toBe(2);
  });

  it("orders sessions by the most recently updated session first", () => {
    const result = getSessionListModel(
      [
        thread({ id: "active-old", status: "running", updatedAt: early }),
        thread({ id: "history-old", status: "idle", updatedAt: early }),
        thread({ id: "attention-old", status: "failed", updatedAt: early }),
        thread({ id: "active-new", status: "running", updatedAt: late }),
        thread({ id: "history-new", status: "idle", updatedAt: late }),
        thread({ id: "attention-new", status: "stale", updatedAt: late }),
        thread({ id: "active-middle", status: "running", updatedAt: middle })
      ],
      [],
      ""
    );

    expect(result.threads.map((candidate) => candidate.id)).toEqual([
      "active-new",
      "history-new",
      "attention-new",
      "active-middle",
      "active-old",
      "history-old",
      "attention-old"
    ]);
  });

  it("keeps the existing order stable for sessions with the same update time", () => {
    const result = getSessionListModel(
      [
        thread({ id: "first", status: "idle", updatedAt: middle }),
        thread({ id: "second", status: "failed", updatedAt: middle }),
        thread({ id: "third", status: "running", updatedAt: middle })
      ],
      [],
      ""
    );

    expect(result.threads.map((candidate) => candidate.id)).toEqual(["first", "second", "third"]);
  });
});
