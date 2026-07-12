import { describe, expect, it } from "vitest";
import {
	applyEventProjection,
	applyEventProjectionBatch,
	type ClientProjection,
} from "../src/client/eventProjection.js";
import {
	applyOptimisticTurnDraft,
	createOptimisticTurnDraft,
} from "../src/client/optimisticThreads.js";
import type {
	ControlThread,
	CozEvent,
	DashboardState,
	ThreadDetail,
	ThreadItem,
	Turn,
} from "../src/server/domain.js";

const createdAt = "2026-06-13T00:00:00.000Z";
const updatedAt = "2026-06-13T00:01:00.000Z";

function thread(overrides: Partial<ControlThread> = {}): ControlThread {
	return {
		id: "thread-1",
		sessionId: "session-1",
		forkedFromId: null,
		parentThreadId: null,
		sourceKind: "app_server",
		agentNickname: null,
		agentRole: null,
		name: "Improve the console",
		preview: "Initial prompt",
		cwd: "/tmp/coz",
		model: "gpt-test",
		status: "active",
		activeTurnId: "turn-1",
		lastTurnStatus: "in_progress",
		goalObjective: null,
		goalStatus: null,
		goalTokenBudget: null,
		tokensUsed: 0,
		contextWindow: null,
		tagScore: null,
		lifecycleState: "active",
		desiredArchived: false,
		remoteArchived: false,
		remoteObservedAt: createdAt,
		remoteUpdatedAt: createdAt,
		localUpdatedAt: createdAt,
		runtimeSeenAt: createdAt,
		runtimeEpoch: 1,
		syncGeneration: 1,
		stateRevision: 1,
		lastOperationError: null,
		archivedAt: null,
		createdAt,
		updatedAt: createdAt,
		...overrides,
	};
}

function turn(overrides: Partial<Turn> = {}): Turn {
	return {
		id: "turn-1",
		threadId: "thread-1",
		status: "in_progress",
		prompt: "Initial prompt",
		startedAt: createdAt,
		completedAt: null,
		durationMs: null,
		...overrides,
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
		...overrides,
	};
}

function state(overrides: Partial<DashboardState> = {}): DashboardState {
	const threads = overrides.threads ?? [thread()];
	return {
		threads,
		threadTotalCount: threads.length,
		threadPageSize: 50,
		threadNextCursor: threads.length
			? {
					updatedAt: threads[threads.length - 1].updatedAt,
					id: threads[threads.length - 1].id,
				}
			: null,
		threadHasMore: false,
		defaultCwd: "/tmp/coz",
		defaultModel: null,
		latestEventId: 0,
		...overrides,
	};
}

function detail(overrides: Partial<ThreadDetail> = {}): ThreadDetail {
	const baseThread = thread();
	return {
		...baseThread,
		turns: [turn()],
		items: [item()],
		itemTotalCount: 1,
		itemPageSize: 1,
		itemPageDirection: "after",
		itemNextCursor: null,
		itemHasMore: false,
		latestEventId: 0,
		...overrides,
	};
}

function projection(): ClientProjection {
	const baseThread = thread();
	return {
		state: state({ threads: [baseThread] }),
		detail: detail(baseThread),
	};
}

function event(
	type: string,
	payload: Record<string, unknown>,
	overrides: Partial<CozEvent> = {},
): CozEvent {
	return {
		id: 1,
		type,
		threadId: "thread-1",
		turnId: "turn-1",
		payload,
		createdAt: updatedAt,
		...overrides,
	};
}

describe("client event projection", () => {
	it("updates transcript items from high-frequency item events without a fallback refresh", () => {
		const result = applyEventProjection(
			projection(),
			event("item.delta", {
				itemId: "item-1",
				delta: "\nDone",
				itemType: "agent",
			}),
		);

		expect(result.changed).toBe(true);
		expect(result.handled).toBe(true);
		expect(result.needsRefresh).toBe(false);
		expect(result.detail?.items).toHaveLength(1);
		expect(result.detail?.items[0].text).toBe("Working\nDone");
	});

	it("keeps projection identity for transcript events from non-selected threads", () => {
		const current = projection();
		const result = applyEventProjection(
			current,
			event(
				"item.delta",
				{
					itemId: "item-background",
					delta: "Background update",
					itemType: "agent",
				},
				{ threadId: "thread-background" },
			),
		);

		expect(result.changed).toBe(false);
		expect(result.handled).toBe(true);
		expect(result.needsRefresh).toBe(false);
		expect(result.state).toBe(current.state);
		expect(result.detail).toBe(current.detail);
	});

	it("keeps projection identity for duplicate selected transcript payloads", () => {
		const current = projection();
		const result = applyEventProjection(
			current,
			event("item.delta", {
				itemId: "item-1",
				delta: "",
				itemType: "agent",
			}),
		);

		expect(result.changed).toBe(false);
		expect(result.handled).toBe(true);
		expect(result.needsRefresh).toBe(false);
		expect(result.state).toBe(current.state);
		expect(result.detail).toBe(current.detail);
	});

	it("updates the latest transcript item without reordering existing items", () => {
		const firstItem = item({ id: "item-1", text: "First" });
		const latestItem = item({ id: "item-2", text: "Latest" });
		const current = projection();
		const currentWithItems: ClientProjection = {
			...current,
			detail: current.detail
				? {
						...current.detail,
						items: [firstItem, latestItem],
					}
				: null,
		};
		const result = applyEventProjection(
			currentWithItems,
			event("item.delta", {
				itemId: "item-2",
				delta: " update",
				itemType: "agent",
			}),
		);

		expect(result.detail?.items.map((candidate) => candidate.id)).toEqual([
			"item-1",
			"item-2",
		]);
		expect(result.detail?.items[0]).toBe(firstItem);
		expect(result.detail?.items[1]).toMatchObject({
			id: "item-2",
			text: "Latest update",
		});
	});

	it("projects turn completion into thread and selected detail state", () => {
		const result = applyEventProjection(
			projection(),
			event("turn.status", {
				status: "completed",
			}),
		);

		expect(result.changed).toBe(true);
		expect(result.handled).toBe(true);
		expect(result.needsRefresh).toBe(false);
		expect(result.state.threads[0]).toMatchObject({
			status: "idle",
			activeTurnId: null,
			lastTurnStatus: "completed",
			updatedAt,
		});
		expect(result.detail?.turns[0]).toMatchObject({
			status: "completed",
			completedAt: updatedAt,
		});
	});

	it("rebases an optimistic turn when the real turn start arrives", () => {
		const idleThread = thread({
			status: "idle",
			activeTurnId: null,
			lastTurnStatus: "completed",
		});
		const base: ClientProjection = {
			state: state({ threads: [idleThread] }),
			detail: detail({
				...idleThread,
				turns: [],
				items: [],
				itemTotalCount: 0,
			}),
		};
		const draft = createOptimisticTurnDraft({
			thread: base.state.threads[0],
			prompt: "Continue the work",
			goalMode: false,
			now: createdAt,
		});
		const optimistic = applyOptimisticTurnDraft(base, draft);
		const realTurn = turn({
			id: "turn-real",
			prompt: "Continue the work",
			startedAt: updatedAt,
		});

		const result = applyEventProjection(
			optimistic,
			event("turn.started", { turn: realTurn }, { turnId: "turn-real" }),
		);

		expect(result.detail?.turns.map((candidate) => candidate.id)).toEqual([
			"turn-real",
		]);
		expect(
			result.detail?.items.find(
				(candidate) => candidate.text === "Continue the work",
			),
		).toMatchObject({
			text: "Continue the work",
			turnId: "turn-real",
		});
		expect(result.state.threads[0]).toMatchObject({
			activeTurnId: "turn-real",
			preview: "Continue the work",
		});
	});

	it("replaces a matching optimistic user item with the real item", () => {
		const base = projection();
		const draft = createOptimisticTurnDraft({
			thread: base.state.threads[0],
			prompt: "Focus on verification",
			goalMode: false,
			now: createdAt,
		});
		const optimistic = applyOptimisticTurnDraft(base, draft);
		const realItem = item({
			id: "item-real-user",
			type: "user",
			text: "Focus on verification",
			turnId: draft.turnId,
			data: { source: "runtime" },
		});

		const result = applyEventProjection(
			optimistic,
			event("item.created", { item: realItem }, { turnId: draft.turnId }),
		);

		expect(
			result.detail?.items.filter(
				(candidate) => candidate.text === "Focus on verification",
			),
		).toEqual([realItem]);
	});

	it("preserves thread content time from thread status payloads", () => {
		const contentUpdatedAt = "2026-06-13T00:00:30.000Z";
		const syncedThread = thread({
			status: "idle",
			activeTurnId: null,
			preview: "Runtime preview",
			updatedAt: contentUpdatedAt,
		});
		const result = applyEventProjection(
			projection(),
			event("thread.status", {
				status: "idle",
				thread: syncedThread,
			}),
		);

		expect(result.changed).toBe(true);
		expect(result.state.threads[0]).toMatchObject({
			status: "idle",
			activeTurnId: null,
			preview: "Runtime preview",
			updatedAt: contentUpdatedAt,
		});
		expect(result.detail).toMatchObject({
			status: "idle",
			activeTurnId: null,
			preview: "Runtime preview",
			updatedAt: contentUpdatedAt,
		});
	});

	it("projects thread tag score updates without a fallback refresh", () => {
		const scoredThread = thread({
			tagScore: 3,
			updatedAt: createdAt,
		});
		const result = applyEventProjection(
			projection(),
			event(
				"thread.tag.updated",
				{
					tagScore: 3,
					thread: scoredThread,
				},
				{ turnId: null },
			),
		);

		expect(result.changed).toBe(true);
		expect(result.handled).toBe(true);
		expect(result.needsRefresh).toBe(false);
		expect(result.state.threads[0]).toMatchObject({
			tagScore: 3,
			updatedAt: createdAt,
		});
		expect(result.detail).toMatchObject({
			tagScore: 3,
			updatedAt: createdAt,
		});
	});

	it("upserts new threads and keeps the low-frequency relationship refresh signal", () => {
		const newThread = thread({
			id: "thread-2",
			sessionId: "session-2",
			activeTurnId: null,
			status: "idle",
		});
		const result = applyEventProjection(
			projection(),
			event(
				"thread.started",
				{ thread: newThread },
				{ threadId: "thread-2", turnId: null },
			),
		);

		expect(result.changed).toBe(true);
		expect(result.handled).toBe(true);
		expect(result.needsRefresh).toBe(true);
		expect(result.state.threads.map((candidate) => candidate.id)).toEqual([
			"thread-2",
			"thread-1",
		]);
		expect(result.state.threadTotalCount).toBe(2);
		expect(result.state.threadNextCursor).toBeNull();
	});

	it("keeps runtime-discovered subagent threads out of navigation state", () => {
		const discovered = thread({
			id: "thread-child",
			sessionId: "thread-child",
			parentThreadId: "thread-1",
			sourceKind: "subagent",
			agentNickname: "scout",
			activeTurnId: null,
			status: "active",
		});
		const result = applyEventProjection(
			projection(),
			event(
				"thread.discovered",
				{ thread: discovered },
				{ threadId: "thread-child", turnId: null },
			),
		);

		expect(result.changed).toBe(false);
		expect(result.handled).toBe(true);
		expect(result.needsRefresh).toBe(true);
		expect(result.state.threads.map((candidate) => candidate.id)).toEqual([
			"thread-1",
		]);
		expect(result.state.threadTotalCount).toBe(1);
	});

	it("updates an open subagent detail without inserting a navigation row", () => {
		const discovered = thread({
			id: "thread-child",
			sessionId: "thread-child",
			parentThreadId: "thread-1",
			sourceKind: "subagent",
			agentNickname: "scout",
			status: "active",
			tokensUsed: 42,
		});
		const current = projection();
		const result = applyEventProjection(
			{
				state: current.state,
				detail: detail({
					...discovered,
					tokensUsed: 10,
				}),
			},
			event(
				"thread.discovered",
				{ thread: discovered },
				{ threadId: "thread-child", turnId: null },
			),
		);

		expect(result.changed).toBe(true);
		expect(result.state.threads.map((candidate) => candidate.id)).toEqual([
			"thread-1",
		]);
		expect(result.state.threadTotalCount).toBe(1);
		expect(result.detail).toMatchObject({
			id: "thread-child",
			tokensUsed: 42,
		});
	});

	it("projects forked threads as inserted threads that require relationship refresh", () => {
		const fork = thread({
			id: "thread-forked",
			sessionId: "session-1",
			forkedFromId: "thread-1",
			activeTurnId: null,
			status: "idle",
		});
		const result = applyEventProjection(
			projection(),
			event(
				"thread.forked",
				{
					thread: fork,
					sourceThreadId: "thread-1",
					reason: "manual",
				},
				{ threadId: "thread-forked", turnId: null },
			),
		);

		expect(result.changed).toBe(true);
		expect(result.handled).toBe(true);
		expect(result.needsRefresh).toBe(true);
		expect(result.state.threads.map((candidate) => candidate.id)).toEqual([
			"thread-forked",
			"thread-1",
		]);
		expect(result.state.threadTotalCount).toBe(2);
		expect(result.state.threadNextCursor).toBeNull();
	});

	it("removes archived threads from the default thread projection", () => {
		const result = applyEventProjection(
			projection(),
			event(
				"thread.archived",
				{
					thread: thread({
						status: "not_loaded",
						activeTurnId: null,
						lifecycleState: "archived",
						desiredArchived: true,
						remoteArchived: true,
						archivedAt: "2026-06-13T00:10:00.000Z",
					}),
				},
				{ turnId: null },
			),
		);

		expect(result.changed).toBe(true);
		expect(result.handled).toBe(true);
		expect(result.needsRefresh).toBe(true);
		expect(result.state.threads).toEqual([]);
		expect(result.state.threadTotalCount).toBe(0);
		expect(result.state.threadNextCursor).toBeNull();
		expect(result.detail).toBeNull();
	});

	it("restores unarchived threads to the default thread projection", () => {
		const current = projection();
		const withoutArchived = {
			...current,
			state: state({ threads: [], threadTotalCount: 0 }),
			detail: null,
		};
		const unarchived = thread({
			status: "not_loaded",
			activeTurnId: null,
			lastTurnStatus: "completed",
			lifecycleState: "active",
			archivedAt: null,
		});
		const result = applyEventProjection(
			withoutArchived,
			event(
				"thread.unarchived",
				{ thread: unarchived },
				{ threadId: unarchived.id, turnId: null },
			),
		);

		expect(result.changed).toBe(true);
		expect(result.handled).toBe(true);
		expect(result.needsRefresh).toBe(true);
		expect(result.state.threads).toEqual([unarchived]);
		expect(result.state.threadTotalCount).toBe(1);
	});

	it("removes archive pending and failed lifecycle states", () => {
		for (const lifecycleState of [
			"archive_pending",
			"archive_failed",
		] as const) {
			const lifecycleThread = thread({
				lifecycleState,
				desiredArchived: true,
				lastOperationError:
					lifecycleState === "archive_failed" ? "runtime unavailable" : null,
			});
			const result = applyEventProjection(
				projection(),
				event(
					"thread.lifecycle.updated",
					{ thread: lifecycleThread },
					{ turnId: null },
				),
			);

			expect(result.handled).toBe(true);
			expect(result.state.threads).toEqual([]);
		}
	});

	it("refreshes when an unarchive event has no canonical thread", () => {
		const current = projection();
		const result = applyEventProjection(
			current,
			event("thread.unarchived", {}, { turnId: null }),
		);

		expect(result.changed).toBe(false);
		expect(result.handled).toBe(true);
		expect(result.needsRefresh).toBe(true);
	});

	it("removes deleted threads and their selected detail", () => {
		const result = applyEventProjection(
			projection(),
			event("thread.deleted", {}, { turnId: null }),
		);

		expect(result.changed).toBe(true);
		expect(result.handled).toBe(true);
		expect(result.needsRefresh).toBe(true);
		expect(result.state.threads).toEqual([]);
		expect(result.detail).toBeNull();
	});

	it("does not insert unloaded threads for ordinary thread metadata updates", () => {
		const current = projection();
		const backgroundThread = thread({
			id: "thread-background",
			sessionId: "session-background",
			tokensUsed: 99,
		});
		const result = applyEventProjection(
			current,
			event(
				"thread.token_usage",
				{ thread: backgroundThread },
				{ threadId: "thread-background", turnId: null },
			),
		);

		expect(result.changed).toBe(false);
		expect(result.handled).toBe(true);
		expect(result.state).toBe(current.state);
		expect(result.state.threads.map((candidate) => candidate.id)).toEqual([
			"thread-1",
		]);
	});

	it("applies queued high-frequency events as one ordered projection", () => {
		const result = applyEventProjectionBatch(projection(), [
			event(
				"item.delta",
				{ itemId: "item-1", delta: ".", itemType: "agent" },
				{ id: 2 },
			),
			event(
				"item.delta",
				{ itemId: "item-1", delta: " Done.", itemType: "agent" },
				{ id: 3 },
			),
			event("turn.status", { status: "completed" }, { id: 4 }),
		]);

		expect(result.changed).toBe(true);
		expect(result.handled).toBe(true);
		expect(result.needsRefresh).toBe(false);
		expect(result.detail?.items[0].text).toBe("Working. Done.");
		expect(result.detail?.turns[0].status).toBe("completed");
		expect(result.state.threads[0].status).toBe("idle");
	});

	it("reports unchanged batches when every event is a local no-op", () => {
		const current = projection();
		const result = applyEventProjectionBatch(current, [
			event(
				"item.delta",
				{
					itemId: "item-background",
					delta: "Background update",
					itemType: "agent",
				},
				{ id: 2, threadId: "thread-background" },
			),
			event("turn.steered", {}, { id: 3 }),
		]);

		expect(result.changed).toBe(false);
		expect(result.handled).toBe(true);
		expect(result.needsRefresh).toBe(false);
		expect(result.state).toBe(current.state);
		expect(result.detail).toBe(current.detail);
	});
});
