import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { RuntimeThreadSnapshot } from "../src/server/codex/runtimePort.js";
import type { CozEvent } from "../src/server/domain.js";
import { EventBus } from "../src/server/eventBus.js";
import { Store } from "../src/server/store.js";
import { ThreadProjection } from "../src/server/threadProjection.js";

let tempDir: string;
let store: Store;
let events: CozEvent[];
let projection: ThreadProjection;

function runtimeThreadSnapshot(
	input: Partial<RuntimeThreadSnapshot> = {},
): RuntimeThreadSnapshot {
	return {
		id: input.id ?? "thread-1",
		sessionId: input.sessionId ?? "session-1",
		forkedFromId: input.forkedFromId ?? null,
		parentThreadId: input.parentThreadId ?? null,
		sourceKind: input.sourceKind ?? "app_server",
		agentNickname: input.agentNickname ?? null,
		agentRole: input.agentRole ?? null,
		name: input.name ?? null,
		preview: input.preview ?? "Initial preview",
		cwd: input.cwd ?? tempDir,
		model: input.model ?? "model-a",
		status: input.status ?? "idle",
		activeTurnId: input.activeTurnId ?? null,
		updatedAt: input.updatedAt ?? "2026-01-01T00:00:00.000Z",
	};
}

function createThread(input: Partial<RuntimeThreadSnapshot> = {}) {
	return projection.createThread({
		runtimeThread: runtimeThreadSnapshot(input),
		name: "Test thread",
		goalObjective: null,
		goalStatus: null,
		goalTokenBudget: null,
		tokensUsed: 0,
	});
}

beforeEach(() => {
	tempDir = mkdtempSync(join(tmpdir(), "coz-thread-projection-"));
	store = Store.open(join(tempDir, "projection.sqlite"));
	const eventBus = new EventBus();
	events = [];
	eventBus.subscribe((event) => events.push(event));
	projection = new ThreadProjection(store, eventBus);
});

afterEach(() => {
	store.close();
	rmSync(tempDir, { recursive: true, force: true });
});

describe("ThreadProjection", () => {
	it("ignores token usage for an unloaded subagent thread", () => {
		projection.applyRuntimeEvent({
			type: "thread.token_usage",
			threadId: "thread-child",
			turnId: null,
			usage: {
				totalTokens: 42,
				inputTokens: 20,
				cachedInputTokens: 4,
				outputTokens: 18,
				reasoningOutputTokens: 2,
				modelContextWindow: 128_000,
			},
		});

		expect(store.getThread("thread-child")).toBeNull();
		expect(events).toEqual([]);
	});

	it("updates token usage for a loaded thread", () => {
		createThread();

		projection.applyRuntimeEvent({
			type: "thread.token_usage",
			threadId: "thread-1",
			turnId: null,
			usage: {
				totalTokens: 42,
				inputTokens: 20,
				cachedInputTokens: 4,
				outputTokens: 18,
				reasoningOutputTokens: 2,
				modelContextWindow: 128_000,
			},
		});

		expect(store.getThread("thread-1")?.tokensUsed).toBe(42);
		expect(events.map((event) => event.type)).toEqual(["thread.token_usage"]);
	});

	it("synthesizes a missing subagent turn before storing token usage", () => {
		createThread({
			id: "thread-child",
			parentThreadId: "thread-parent",
			sourceKind: "subagent",
			agentNickname: "scout",
		});

		projection.applyRuntimeEvent({
			type: "thread.token_usage",
			threadId: "thread-child",
			turnId: "turn-child",
			usage: {
				totalTokens: 42,
				inputTokens: 20,
				cachedInputTokens: 4,
				outputTokens: 18,
				reasoningOutputTokens: 2,
				modelContextWindow: 128_000,
			},
		});

		expect(store.getTurn("turn-child")).toMatchObject({
			id: "turn-child",
			threadId: "thread-child",
			status: "in_progress",
		});
		expect(store.getThread("thread-child")).toMatchObject({
			activeTurnId: "turn-child",
			status: "active",
			tokensUsed: 42,
		});
		expect(events.map((event) => event.type)).toEqual([
			"turn.started",
			"thread.token_usage",
		]);
		expect(
			store
				.listEvents(0, { threadId: "thread-child" })
				.map((event) => [event.type, event.turnId]),
		).toEqual([
			["turn.started", "turn-child"],
			["thread.token_usage", "turn-child"],
		]);
	});

	it("ignores metadata events whose turn belongs to another thread", () => {
		const firstThread = createThread({ id: "thread-first" });
		createThread({ id: "thread-second" });
		projection.recordTurn(firstThread, "First thread prompt", {
			id: "turn-first",
			status: "in_progress",
		});
		events = [];

		projection.applyRuntimeEvent({
			type: "thread.token_usage",
			threadId: "thread-second",
			turnId: "turn-first",
			usage: {
				totalTokens: 42,
				inputTokens: 20,
				cachedInputTokens: 4,
				outputTokens: 18,
				reasoningOutputTokens: 2,
				modelContextWindow: 128_000,
			},
		});

		expect(store.getThread("thread-second")?.tokensUsed).toBe(0);
		expect(events).toEqual([]);
	});

	it("synthesizes a missing turn and item for early delta events", () => {
		createThread();

		projection.applyRuntimeEvent({
			type: "item.delta",
			threadId: "thread-1",
			turnId: "turn-1",
			itemId: "item-1",
			itemType: "agent",
			delta: "partial answer",
		});

		const detail = store.getThreadDetail("thread-1");
		expect(detail?.turns).toHaveLength(1);
		expect(detail?.turns[0]).toMatchObject({
			id: "turn-1",
			status: "in_progress",
			prompt: "",
		});
		expect(detail?.items).toHaveLength(1);
		expect(detail?.items[0]).toMatchObject({
			id: "item-1",
			text: "partial answer",
			data: { synthesized: true },
		});
		expect(events.map((event) => event.type)).toEqual([
			"turn.started",
			"item.delta",
		]);
		expect(
			store.listEvents(0, { threadId: "thread-1" }).map((event) => event.type),
		).toEqual(["turn.started"]);
	});

	it("updates an active thread from an idle runtime snapshot and interrupts the active turn", () => {
		const thread = createThread({ status: "active", activeTurnId: "turn-1" });
		projection.recordTurn(thread, "working prompt", {
			id: "turn-1",
			status: "in_progress",
		});
		events = [];

		const result = projection.applyRuntimeThreadSnapshot(thread, {
			...runtimeThreadSnapshot({ status: "idle", activeTurnId: null }),
			preview: "Runtime is idle now",
		});

		const detail = store.getThreadDetail("thread-1");
		expect(result.updated).toBe(true);
		expect(detail?.status).toBe("idle");
		expect(detail?.activeTurnId).toBeNull();
		expect(detail?.preview).toBe("Runtime is idle now");
		expect(detail?.turns[0]?.status).toBe("interrupted");
		expect(events.map((event) => event.type)).toEqual(["thread.status"]);
	});

	it("keeps turn completion pending when an idle notification arrives first", () => {
		const thread = createThread({ status: "active", activeTurnId: "turn-1" });
		projection.recordTurn(thread, "working prompt", {
			id: "turn-1",
			status: "in_progress",
		});
		events = [];

		projection.applyRuntimeEvent({
			type: "thread.status",
			threadId: "thread-1",
			status: "idle",
		});

		const detail = store.getThreadDetail("thread-1");
		expect(detail?.status).toBe("idle");
		expect(detail?.activeTurnId).toBeNull();
		expect(detail?.turns[0]?.status).toBe("in_progress");
		expect(events.map((event) => event.type)).toEqual(["thread.status"]);
	});

	it("ignores runtime snapshot timestamp churn when thread fields are unchanged", () => {
		const originalUpdatedAt = "2026-01-01T00:00:00.000Z";
		const runtimeUpdatedAt = "2026-01-01T00:10:00.000Z";
		const thread = createThread({ updatedAt: originalUpdatedAt });
		events = [];

		const result = projection.applyRuntimeThreadSnapshot(thread, {
			...runtimeThreadSnapshot({ updatedAt: runtimeUpdatedAt }),
		});

		const detail = store.getThreadDetail("thread-1");
		expect(result.updated).toBe(false);
		expect(detail?.updatedAt).toBe(originalUpdatedAt);
		expect(events).toEqual([]);
	});

	it("accepts runtime snapshot timestamps when thread status changes", () => {
		const originalUpdatedAt = "2026-01-01T00:00:00.000Z";
		const runtimeUpdatedAt = "2026-01-01T00:10:00.000Z";
		const thread = createThread({ updatedAt: originalUpdatedAt });
		events = [];

		const result = projection.applyRuntimeThreadSnapshot(thread, {
			...runtimeThreadSnapshot({
				status: "not_loaded",
				updatedAt: runtimeUpdatedAt,
			}),
		});

		const detail = store.getThreadDetail("thread-1");
		expect(result.updated).toBe(true);
		expect(detail).toMatchObject({
			status: "not_loaded",
			updatedAt: runtimeUpdatedAt,
		});
		expect(events.map((event) => event.type)).toEqual(["thread.status"]);
	});

	it("projects goal updates and explicit goal clearing", () => {
		createThread();

		projection.updateGoal(
			"thread-1",
			{
				objective: "Finish core refactor",
				status: "in_progress",
				tokenBudget: 1200,
				tokensUsed: 42,
			},
			null,
		);
		projection.updateGoal("thread-1", null, null, { clearedStatus: "cleared" });

		const detail = store.getThreadDetail("thread-1");
		expect(detail?.goalObjective).toBeNull();
		expect(detail?.goalStatus).toBe("cleared");
		expect(detail?.goalTokenBudget).toBeNull();
		expect(detail?.tokensUsed).toBe(42);
		expect(events.map((event) => event.type)).toEqual([
			"thread.goal.updated",
			"thread.goal.cleared",
		]);
	});
});
