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
		lastTurnStatus: null,
		goalObjective: null,
		goalStatus: null,
		goalTokenBudget: null,
		tokensUsed: 0,
		createdAt: "2026-01-01T00:00:00.000Z",
		updatedAt: "2026-01-01T00:00:00.000Z",
	};
}

describe("RuntimeThreadCoordinator", () => {
	it("runs actions directly when the runtime thread is loaded", async () => {
		const source = thread();
		const action = vi.fn(
			async (runtimeThread: ControlThread) => `value:${runtimeThread.id}`,
		);
		const coordinator = new RuntimeThreadCoordinator({
			resumeThread: vi.fn(),
			markThreadLost: vi.fn(),
			forkThread: vi.fn(),
			notResumableError: (runtimeThread) =>
				new Error(`lost ${runtimeThread.id}`),
		});

		await expect(coordinator.run(source, action)).resolves.toEqual({
			thread: source,
			value: "value:thread-1",
		});
		expect(action).toHaveBeenCalledTimes(1);
	});

	it("resumes a missing runtime thread and retries the action", async () => {
		const source = thread();
		const resumed = {
			...source,
			status: "active" as const,
			activeTurnId: "turn-1",
			lastTurnStatus: "in_progress" as const,
		};
		const action = vi
			.fn()
			.mockRejectedValueOnce(new AdapterThreadNotFoundError(source.id))
			.mockResolvedValueOnce("resumed");
		const coordinator = new RuntimeThreadCoordinator({
			resumeThread: vi.fn(async () => resumed),
			markThreadLost: vi.fn(),
			forkThread: vi.fn(),
			notResumableError: (runtimeThread) =>
				new Error(`lost ${runtimeThread.id}`),
		});

		await expect(coordinator.run(source, action)).resolves.toEqual({
			thread: resumed,
			value: "resumed",
		});
		expect(action).toHaveBeenCalledWith(resumed);
	});

	it("marks a non-continuable action not loaded when resume cannot reload the thread", async () => {
		const source = thread();
		const markThreadLost = vi.fn();
		const coordinator = new RuntimeThreadCoordinator({
			resumeThread: vi.fn(async () => null),
			markThreadLost,
			forkThread: vi.fn(),
			notResumableError: (runtimeThread) =>
				new Error(`lost ${runtimeThread.id}`),
		});

		await expect(
			coordinator.run(source, async () => {
				throw new AdapterThreadNotFoundError(source.id);
			}),
		).rejects.toThrow("lost thread-1");
		expect(markThreadLost).toHaveBeenCalledWith(source);
	});

	it("forks when a continuable action cannot be resumed", async () => {
		const source = thread();
		const fork = thread("thread-2");
		const action = vi
			.fn()
			.mockRejectedValueOnce(new AdapterThreadNotFoundError(source.id))
			.mockResolvedValueOnce("forked");
		const forkThread = vi.fn(async () => fork);
		const coordinator = new RuntimeThreadCoordinator({
			resumeThread: vi.fn(async () => null),
			markThreadLost: vi.fn(),
			forkThread,
			notResumableError: (runtimeThread) =>
				new Error(`lost ${runtimeThread.id}`),
		});
		const options = {
			fork: {
				prompt: "Continue from here",
				model: "model-b",
			},
		};

		await expect(coordinator.run(source, action, options)).resolves.toEqual({
			thread: fork,
			value: "forked",
		});
		expect(forkThread).toHaveBeenCalledWith(source, options.fork);
		expect(action).toHaveBeenLastCalledWith(fork);
	});

	it("forks from the resumed snapshot when a continuable retry loses runtime", async () => {
		const source = thread();
		const resumed = {
			...source,
			status: "idle" as const,
			preview: "Fresh runtime preview",
		};
		const fork = thread("thread-2");
		const action = vi
			.fn()
			.mockRejectedValueOnce(new AdapterThreadNotFoundError(source.id))
			.mockRejectedValueOnce(new AdapterThreadNotFoundError(source.id))
			.mockResolvedValueOnce("forked");
		const forkThread = vi.fn(async () => fork);
		const options = {
			fork: {
				prompt: "Retry on a fork",
				model: "model-b",
			},
		};
		const coordinator = new RuntimeThreadCoordinator({
			resumeThread: vi.fn(async () => resumed),
			markThreadLost: vi.fn(),
			forkThread,
			notResumableError: (runtimeThread) =>
				new Error(`lost ${runtimeThread.id}`),
		});

		await expect(coordinator.run(source, action, options)).resolves.toEqual({
			thread: fork,
			value: "forked",
		});
		expect(forkThread).toHaveBeenCalledWith(resumed, options.fork);
		expect(action).toHaveBeenLastCalledWith(fork);
	});

	it("marks not loaded and rethrows adapter loss after a non-continuable resumed retry fails", async () => {
		const source = thread();
		const resumed = { ...source, status: "idle" as const };
		const markThreadLost = vi.fn();
		const retryError = new AdapterThreadNotFoundError(
			source.id,
			"retry missing",
		);
		const action = vi
			.fn()
			.mockRejectedValueOnce(new AdapterThreadNotFoundError(source.id))
			.mockRejectedValueOnce(retryError);
		const coordinator = new RuntimeThreadCoordinator({
			resumeThread: vi.fn(async () => resumed),
			markThreadLost,
			forkThread: vi.fn(),
			notResumableError: (runtimeThread) =>
				new Error(`lost ${runtimeThread.id}`),
		});

		await expect(coordinator.run(source, action)).rejects.toBe(retryError);
		expect(markThreadLost).toHaveBeenCalledWith(source);
	});
});
