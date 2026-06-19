import { describe, expect, it, vi } from "vitest";
import { AdapterThreadNotFoundError } from "../src/server/codex/adapter.js";
import type { ControlThread } from "../src/server/domain.js";
import { RuntimeThreadCoordinator } from "../src/server/runtimeThread.js";

function thread(id = "thread-1"): ControlThread {
  return {
    id,
    sessionId: "session-1",
    forkedFromId: null,
    title: "Thread",
    preview: "Thread preview",
    cwd: "/repo",
    model: "model-a",
    status: "idle",
    activeTurnId: null,
    goalObjective: null,
    goalStatus: null,
    goalTokenBudget: null,
    tokensUsed: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z"
  };
}

describe("RuntimeThreadCoordinator", () => {
  it("runs actions directly when the runtime thread is loaded", async () => {
    const source = thread();
    const action = vi.fn(async (runtimeThread: ControlThread) => `value:${runtimeThread.id}`);
    const coordinator = new RuntimeThreadCoordinator({
      resumeThread: vi.fn(),
      markThreadLost: vi.fn(),
      createContinuationThread: vi.fn(),
      notResumableError: (runtimeThread) => new Error(`lost ${runtimeThread.id}`)
    });

    await expect(coordinator.run(source, action)).resolves.toEqual({
      thread: source,
      value: "value:thread-1"
    });
    expect(action).toHaveBeenCalledTimes(1);
  });

  it("resumes a missing runtime thread and retries the action", async () => {
    const source = thread();
    const resumed = { ...source, status: "running" as const, activeTurnId: "turn-1" };
    const action = vi
      .fn()
      .mockRejectedValueOnce(new AdapterThreadNotFoundError(source.id))
      .mockResolvedValueOnce("resumed");
    const coordinator = new RuntimeThreadCoordinator({
      resumeThread: vi.fn(async () => resumed),
      markThreadLost: vi.fn(),
      createContinuationThread: vi.fn(),
      notResumableError: (runtimeThread) => new Error(`lost ${runtimeThread.id}`)
    });

    await expect(coordinator.run(source, action)).resolves.toEqual({
      thread: resumed,
      value: "resumed"
    });
    expect(action).toHaveBeenCalledWith(resumed);
  });

  it("marks a non-continuable action stale when resume cannot reload the thread", async () => {
    const source = thread();
    const markThreadLost = vi.fn();
    const coordinator = new RuntimeThreadCoordinator({
      resumeThread: vi.fn(async () => null),
      markThreadLost,
      createContinuationThread: vi.fn(),
      notResumableError: (runtimeThread) => new Error(`lost ${runtimeThread.id}`)
    });

    await expect(
      coordinator.run(source, async () => {
        throw new AdapterThreadNotFoundError(source.id);
      })
    ).rejects.toThrow("lost thread-1");
    expect(markThreadLost).toHaveBeenCalledWith(source);
  });

  it("creates a continuation when a continuable action cannot be resumed", async () => {
    const source = thread();
    const continuation = thread("thread-2");
    const action = vi
      .fn()
      .mockRejectedValueOnce(new AdapterThreadNotFoundError(source.id))
      .mockResolvedValueOnce("continued");
    const createContinuationThread = vi.fn(async () => continuation);
    const coordinator = new RuntimeThreadCoordinator({
      resumeThread: vi.fn(async () => null),
      markThreadLost: vi.fn(),
      createContinuationThread,
      notResumableError: (runtimeThread) => new Error(`lost ${runtimeThread.id}`)
    });
    const options = {
      continuation: {
        prompt: "Continue from here",
        model: "model-b"
      }
    };

    await expect(coordinator.run(source, action, options)).resolves.toEqual({
      thread: continuation,
      value: "continued"
    });
    expect(createContinuationThread).toHaveBeenCalledWith(source, options.continuation);
    expect(action).toHaveBeenLastCalledWith(continuation);
  });

  it("marks stale and rethrows adapter loss after a non-continuable resumed retry fails", async () => {
    const source = thread();
    const resumed = { ...source, status: "idle" as const };
    const markThreadLost = vi.fn();
    const retryError = new AdapterThreadNotFoundError(source.id, "retry missing");
    const action = vi
      .fn()
      .mockRejectedValueOnce(new AdapterThreadNotFoundError(source.id))
      .mockRejectedValueOnce(retryError);
    const coordinator = new RuntimeThreadCoordinator({
      resumeThread: vi.fn(async () => resumed),
      markThreadLost,
      createContinuationThread: vi.fn(),
      notResumableError: (runtimeThread) => new Error(`lost ${runtimeThread.id}`)
    });

    await expect(coordinator.run(source, action)).rejects.toBe(retryError);
    expect(markThreadLost).toHaveBeenCalledWith(source);
  });
});
