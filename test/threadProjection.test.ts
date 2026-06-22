import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AdapterThread } from "../src/server/codex/adapter.js";
import type { CozEvent } from "../src/server/domain.js";
import { EventBus } from "../src/server/eventBus.js";
import { Store } from "../src/server/store.js";
import { ThreadProjection } from "../src/server/threadProjection.js";

let tempDir: string;
let store: Store;
let events: CozEvent[];
let projection: ThreadProjection;

function adapterThread(input: Partial<AdapterThread> = {}): AdapterThread {
	return {
		id: input.id ?? "thread-1",
		sessionId: input.sessionId ?? "session-1",
		forkedFromId: input.forkedFromId ?? null,
		preview: input.preview ?? "Initial preview",
		cwd: input.cwd ?? tempDir,
		model: input.model ?? "model-a",
		status: input.status ?? "idle",
		activeTurnId: input.activeTurnId ?? null,
		updatedAt: input.updatedAt ?? "2026-01-01T00:00:00.000Z",
	};
}

function createThread(input: Partial<AdapterThread> = {}) {
	return projection.createThread({
		adapterThread: adapterThread(input),
		title: "Test thread",
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
	it("synthesizes a missing turn and item for early delta events", () => {
		createThread();

		projection.applyAdapterEvent({
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
	});

	it("updates an active thread from an idle runtime snapshot and interrupts the active turn", () => {
		const thread = createThread({ status: "active", activeTurnId: "turn-1" });
		projection.recordTurn(thread, "working prompt", {
			id: "turn-1",
			status: "in_progress",
		});
		events = [];

		const result = projection.applyRuntimeThreadSnapshot(thread, {
			...adapterThread({ status: "idle", activeTurnId: null }),
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
