import { describe, expect, it } from "vitest";
import {
	createOptimisticThreadDraft,
	insertOptimisticThreadState,
	rebaseOptimisticThreadDetail,
	removeOptimisticThreadState,
	replaceOptimisticThreadState,
	shouldResolveOptimisticThread,
} from "../src/client/optimisticThreads.js";
import type {
	ControlThread,
	DashboardState,
	ThreadDetail,
	Turn,
} from "../src/server/domain.js";

const createdAt = "2026-06-13T00:00:00.000Z";
const updatedAt = "2026-06-13T00:01:00.000Z";

function thread(overrides: Partial<ControlThread> = {}): ControlThread {
	return {
		id: "thread-1",
		sessionId: "session-1",
		forkedFromId: null,
		name: "Existing thread",
		preview: "Existing prompt",
		cwd: "/work/coz",
		model: "gpt-test",
		status: "idle",
		activeTurnId: null,
		lastTurnStatus: null,
		goalObjective: null,
		goalStatus: null,
		goalTokenBudget: null,
		tokensUsed: 0,
		archivedAt: null,
		createdAt,
		updatedAt: createdAt,
		...overrides,
	};
}

function state(overrides: Partial<DashboardState> = {}): DashboardState {
	const threads = overrides.threads ?? [thread()];
	return {
		threads,
		threadTotalCount: threads.length,
		threadPageSize: 50,
		threadNextCursor: null,
		threadHasMore: false,
		defaultCwd: "/work/coz",
		latestEventId: 10,
		...overrides,
	};
}

function turn(overrides: Partial<Turn> = {}): Turn {
	return {
		id: "turn-real",
		threadId: "thread-real",
		status: "in_progress",
		prompt: "Ship the UI",
		startedAt: updatedAt,
		completedAt: null,
		durationMs: null,
		...overrides,
	};
}

describe("optimistic thread projection helpers", () => {
	it("creates a selected draft with prompt content and increments the thread count", () => {
		const draft = createOptimisticThreadDraft({
			id: "optimistic-thread-1",
			cwd: "/work/coz",
			prompt: "Ship the UI",
			goalMode: false,
			model: "gpt-test",
			latestEventId: 10,
			now: updatedAt,
		});
		const nextState = insertOptimisticThreadState(state(), draft.thread);

		expect(draft.thread).toMatchObject({
			id: "optimistic-thread-1",
			name: "Ship the UI",
			status: "active",
			activeTurnId: "optimistic-thread-1:turn",
		});
		expect(draft.detail.items).toMatchObject([
			{
				type: "user",
				text: "Ship the UI",
				threadId: "optimistic-thread-1",
			},
		]);
		expect(nextState.threads.map((candidate) => candidate.id)).toEqual([
			"optimistic-thread-1",
			"thread-1",
		]);
		expect(nextState.threadTotalCount).toBe(2);
	});

	it("replaces a temporary thread with the real thread without double counting", () => {
		const draft = createOptimisticThreadDraft({
			id: "optimistic-thread-1",
			cwd: "/work/coz",
			prompt: "Ship the UI",
			goalMode: false,
			model: "gpt-test",
			latestEventId: 10,
			now: createdAt,
		});
		const currentState = insertOptimisticThreadState(state(), draft.thread);
		const realThread = thread({
			id: "thread-real",
			sessionId: "session-real",
			name: "Ship the UI",
			preview: "Ship the UI",
			status: "active",
			activeTurnId: "turn-real",
			lastTurnStatus: "in_progress",
			updatedAt,
		});

		const nextState = replaceOptimisticThreadState(currentState, {
			optimisticThreadId: draft.thread.id,
			thread: realThread,
		});
		const nextDetail = rebaseOptimisticThreadDetail(draft.detail, {
			optimisticThreadId: draft.thread.id,
			thread: realThread,
			turn: turn(),
		});

		expect(nextState.threads.map((candidate) => candidate.id)).toEqual([
			"thread-real",
			"thread-1",
		]);
		expect(nextState.threadTotalCount).toBe(2);
		expect(nextDetail).toMatchObject<Partial<ThreadDetail>>({
			id: "thread-real",
			activeTurnId: "turn-real",
		});
		expect(nextDetail?.turns.map((candidate) => candidate.id)).toEqual([
			"turn-real",
		]);
		expect(nextDetail?.items).toMatchObject([
			{
				threadId: "thread-real",
				turnId: "turn-real",
				text: "Ship the UI",
			},
		]);
	});

	it("does not duplicate the real thread if a server event already inserted it", () => {
		const optimisticThread = thread({ id: "optimistic-thread-1" });
		const realThread = thread({ id: "thread-real" });
		const currentState = state({
			threads: [realThread, optimisticThread, thread({ id: "thread-1" })],
			threadTotalCount: 3,
		});

		const nextState = replaceOptimisticThreadState(currentState, {
			optimisticThreadId: optimisticThread.id,
			thread: { ...realThread, preview: "Updated from POST response" },
		});

		expect(nextState.threads.map((candidate) => candidate.id)).toEqual([
			"thread-real",
			"thread-1",
		]);
		expect(nextState.threads[0].preview).toBe("Updated from POST response");
		expect(nextState.threadTotalCount).toBe(2);
	});

	it("rebases a previously resolved detail when the POST response includes the real turn", () => {
		const draft = createOptimisticThreadDraft({
			id: "optimistic-thread-1",
			cwd: "/work/coz",
			prompt: "Ship the UI",
			goalMode: false,
			model: "gpt-test",
			latestEventId: 10,
			now: createdAt,
		});
		const realThread = thread({
			id: "thread-real",
			sessionId: "session-real",
			name: "Ship the UI",
			preview: "Ship the UI",
			status: "active",
			activeTurnId: "turn-real",
			lastTurnStatus: "in_progress",
			updatedAt,
		});
		const resolvedDetail = rebaseOptimisticThreadDetail(draft.detail, {
			optimisticThreadId: draft.thread.id,
			thread: realThread,
			turn: null,
		});

		const nextDetail = rebaseOptimisticThreadDetail(resolvedDetail, {
			optimisticThreadId: draft.thread.id,
			thread: realThread,
			turn: turn(),
		});

		expect(nextDetail?.id).toBe("thread-real");
		expect(nextDetail?.turns.map((candidate) => candidate.id)).toEqual([
			"turn-real",
		]);
		expect(nextDetail?.items.map((item) => item.turnId)).toEqual(["turn-real"]);
	});

	it("removes an optimistic thread on failure and restores the count", () => {
		const draft = createOptimisticThreadDraft({
			id: "optimistic-thread-1",
			cwd: "/work/coz",
			prompt: "Ship the UI",
			goalMode: true,
			model: null,
			latestEventId: 10,
			now: updatedAt,
		});
		const currentState = insertOptimisticThreadState(state(), draft.thread);
		const nextState = removeOptimisticThreadState(
			currentState,
			draft.thread.id,
		);

		expect(nextState.threads.map((candidate) => candidate.id)).toEqual([
			"thread-1",
		]);
		expect(nextState.threadTotalCount).toBe(1);
	});

	it("matches only the server-created thread for a pending optimistic submission", () => {
		const pending = {
			cwd: "/work/coz",
			name: "Ship the UI",
			createdAt,
		};

		expect(
			shouldResolveOptimisticThread(pending, {
				cwd: "/work/coz",
				name: "Ship the UI",
				createdAt: updatedAt,
			}),
		).toBe(true);
		expect(
			shouldResolveOptimisticThread(pending, {
				cwd: "/work/other",
				name: "Ship the UI",
				createdAt: updatedAt,
			}),
		).toBe(false);
		expect(
			shouldResolveOptimisticThread(pending, {
				cwd: "/work/coz",
				name: "Older matching title",
				createdAt: updatedAt,
			}),
		).toBe(false);
		expect(
			shouldResolveOptimisticThread(pending, {
				cwd: "/work/coz",
				name: "Ship the UI",
				createdAt: "2026-06-12T23:59:59.000Z",
			}),
		).toBe(false);
	});
});
