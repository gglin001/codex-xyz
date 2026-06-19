import { describe, expect, it } from "vitest";
import { getSessionListModel, selectionTouchesThreadGroup } from "../src/client/sessionList.js";
import type { ControlThread } from "../src/server/domain.js";

const createdAt = "2026-06-13T00:00:00.000Z";
const early = "2026-06-13T00:01:00.000Z";
const middle = "2026-06-13T00:02:00.000Z";
const late = "2026-06-13T00:03:00.000Z";

function thread(overrides: Partial<ControlThread> = {}): ControlThread {
  return {
    id: "thread-1",
    sessionId: "session-1",
    forkedFromId: null,
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

describe("session list model", () => {
  it("detects whether a selection change touches a visible group", () => {
    const threads = [thread({ id: "alpha" }), thread({ id: "beta" })];

    expect(selectionTouchesThreadGroup(threads, "alpha", "alpha")).toBe(false);
    expect(selectionTouchesThreadGroup(threads, null, "alpha")).toBe(true);
    expect(selectionTouchesThreadGroup(threads, "beta", "outside")).toBe(true);
    expect(selectionTouchesThreadGroup(threads, "outside-a", "outside-b")).toBe(false);
    expect(selectionTouchesThreadGroup(threads, null, "outside")).toBe(false);
  });

  it("keeps visible sessions ordered by workdir recency and session recency", () => {
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
    expect(result.projectGroups).toHaveLength(1);
    expect(result.projectGroups[0]?.threads.map((candidate) => candidate.id)).toEqual([
      "idle",
      "failed",
      "running",
      "interrupted",
      "stale",
      "blocked-goal"
    ]);
    expect(result.projectGroups[0]).toMatchObject({
      name: "codex-xyz",
      path: "/tmp/codex-xyz",
      threadCount: 6,
      runningCount: 1,
      attentionCount: 3,
      goalCount: 1,
      updatedAt: late
    });
    expect(result.visibleThreadCount).toBe(6);
    expect(result.visibleProjectCount).toBe(1);
    expect(result.totalThreadCount).toBe(6);
    expect(result.hasQuery).toBe(false);
  });

  it("groups sessions by working directory", () => {
    const result = getSessionListModel(
      [
        thread({ id: "xyz-old", cwd: "/work/codex-xyz", updatedAt: early }),
        thread({ id: "api-latest", cwd: "/work/api-server", updatedAt: late }),
        thread({ id: "xyz-middle", cwd: "/work/codex-xyz", updatedAt: middle })
      ],
      ""
    );

    expect(result.projectGroups.map((group) => group.name)).toEqual(["api-server", "codex-xyz"]);
    expect(result.projectGroups.map((group) => group.path)).toEqual(["/work/api-server", "/work/codex-xyz"]);
    expect(result.projectGroups[1]?.threads.map((candidate) => candidate.id)).toEqual(["xyz-middle", "xyz-old"]);
    expect(result.visibleProjectCount).toBe(2);
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

    expect(getSessionListModel(threads, "runtime").visibleThreadCount).toBe(1);
    expect(getSessionListModel(threads, "stale").visibleThreadCount).toBe(1);
    expect(getSessionListModel(threads, "fork-lab").visibleThreadCount).toBe(1);
    expect(getSessionListModel(threads, "failed").visibleThreadCount).toBe(1);
    expect(getSessionListModel(threads, "gpt-fast").visibleThreadCount).toBe(1);
    expect(getSessionListModel(threads, "blocked").visibleThreadCount).toBe(1);
    expect(getSessionListModel(threads, "special").visibleThreadCount).toBe(1);
  });

  it("keeps pagination metadata independent from the session query", () => {
    const result = getSessionListModel(
      [thread({ id: "visible", title: "Match" }), thread({ id: "hidden", title: "Other" })],
      "match",
      {
        totalThreadCount: 10,
        hasMoreThreads: true
      }
    );

    expect(result.visibleThreadCount).toBe(1);
    expect(result.totalThreadCount).toBe(10);
    expect(result.loadedThreadCount).toBe(2);
    expect(result.hasMoreThreads).toBe(true);
    expect(result.hasQuery).toBe(true);
  });
});
