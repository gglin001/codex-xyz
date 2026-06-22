import { describe, expect, it } from "vitest";
import {
	applyEventProjection,
	applyEventProjectionBatch,
	type ClientProjection,
} from "../src/client/eventProjection.js";
import type {
	ControlThread,
	DashboardState,
	ThreadDetail,
	ThreadItem,
	Turn,
	XyzEvent,
} from "../src/server/domain.js";

const createdAt = "2026-06-13T00:00:00.000Z";
const updatedAt = "2026-06-13T00:01:00.000Z";

function thread(overrides: Partial<ControlThread> = {}): ControlThread {
	return {
		id: "thread-1",
		sessionId: "session-1",
		forkedFromId: null,
		title: "Improve the console",
		preview: "Initial prompt",
		cwd: "/tmp/codex-xyz",
		model: "gpt-test",
		status: "active",
		activeTurnId: "turn-1",
		lastTurnStatus: "in_progress",
		goalObjective: null,
		goalStatus: null,
		goalTokenBudget: null,
		tokensUsed: 0,
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
		threadNextOffset: threads.length,
		threadHasMore: false,
		defaultCwd: "/tmp/codex-xyz",
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
	overrides: Partial<XyzEvent> = {},
): XyzEvent {
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
		const updatedItem = item({ text: "Working\nDone" });
		const result = applyEventProjection(
			projection(),
			event("item.delta", { item: updatedItem }),
		);

		expect(result.changed).toBe(true);
		expect(result.handled).toBe(true);
		expect(result.needsRefresh).toBe(false);
		expect(result.detail?.items).toHaveLength(1);
		expect(result.detail?.items[0].text).toBe("Working\nDone");
	});

	it("keeps projection identity for transcript events from non-selected sessions", () => {
		const current = projection();
		const backgroundItem = item({
			id: "item-background",
			threadId: "thread-background",
			text: "Background update",
		});
		const result = applyEventProjection(
			current,
			event(
				"item.delta",
				{ item: backgroundItem },
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
		const duplicateItem = item();
		const result = applyEventProjection(
			current,
			event("item.delta", { item: duplicateItem }),
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
			event("item.delta", { item: { ...latestItem, text: "Latest update" } }),
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
		expect(result.state.threadNextOffset).toBe(2);
	});

	it("projects continuation threads as inserted threads that require relationship refresh", () => {
		const continuation = thread({
			id: "thread-continued",
			sessionId: "session-1",
			forkedFromId: "thread-1",
			activeTurnId: null,
			status: "idle",
		});
		const result = applyEventProjection(
			projection(),
			event(
				"thread.continued",
				{
					thread: continuation,
					sourceThreadId: "thread-1",
				},
				{ threadId: "thread-continued", turnId: null },
			),
		);

		expect(result.changed).toBe(true);
		expect(result.handled).toBe(true);
		expect(result.needsRefresh).toBe(true);
		expect(result.state.threads.map((candidate) => candidate.id)).toEqual([
			"thread-continued",
			"thread-1",
		]);
		expect(result.state.threadTotalCount).toBe(2);
		expect(result.state.threadNextOffset).toBe(2);
	});

	it("does not insert unloaded sessions for ordinary thread metadata updates", () => {
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
			event("item.delta", { item: item({ text: "Working." }) }, { id: 2 }),
			event(
				"item.delta",
				{ item: item({ text: "Working. Done." }) },
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
					item: item({
						id: "item-background",
						threadId: "thread-background",
						text: "Background update",
					}),
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
