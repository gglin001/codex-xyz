import { describe, expect, it } from "vitest";
import type { RuntimeThreadSnapshot } from "../src/server/codex/runtimePort.js";
import { Store } from "../src/server/store.js";
import {
	reconcileRuntimeThreadHistory,
	reconcileRuntimeThreads,
} from "../src/server/threadHistoryReconciliation.js";

function runtimeThread(
	id: string,
	input: Partial<RuntimeThreadSnapshot> = {},
): RuntimeThreadSnapshot {
	return {
		id,
		sessionId: input.sessionId ?? id,
		forkedFromId: input.forkedFromId ?? null,
		parentThreadId: input.parentThreadId ?? null,
		sourceKind: input.sourceKind ?? "app_server",
		agentNickname: input.agentNickname ?? null,
		agentRole: input.agentRole ?? null,
		name: input.name ?? `Thread ${id}`,
		preview: input.preview ?? `Preview ${id}`,
		cwd: input.cwd ?? "/workspace",
		model: input.model ?? null,
		status: input.status ?? "not_loaded",
		activeTurnId: input.activeTurnId ?? null,
		updatedAt: input.updatedAt ?? "2026-07-11T00:00:00.000Z",
	};
}

describe("thread history reconciliation", () => {
	it("recovers a known active turn when a summary omits its id", () => {
		const store = Store.open(":memory:");
		try {
			reconcileRuntimeThreads(store, [runtimeThread("a", { status: "idle" })]);
			store.createTurn({
				id: "turn-live",
				threadId: "a",
				status: "in_progress",
				prompt: "Live work",
				startedAt: "2026-07-12T00:00:00.000Z",
				completedAt: null,
				durationMs: null,
			});
			store.updateThread("a", {
				status: "active",
				activeTurnId: null,
				lastTurnStatus: "in_progress",
			});
			const summary = runtimeThread("a", {
				status: "active",
				preview: "Updated summary",
			});
			delete summary.activeTurnId;

			reconcileRuntimeThreads(store, [summary]);

			expect(store.getThread("a")).toMatchObject({
				status: "active",
				activeTurnId: "turn-live",
				lastTurnStatus: "in_progress",
				preview: "Updated summary",
			});
		} finally {
			store.close();
		}
	});

	it("discovers threads idempotently and preserves local metadata", () => {
		const store = Store.open(":memory:");
		try {
			const [discovered] = reconcileRuntimeThreads(store, [runtimeThread("a")]);
			store.updateThreadTagScore("a", 3);

			const [updated] = reconcileRuntimeThreads(store, [
				runtimeThread("a", {
					name: "Renamed",
					preview: "Updated preview",
					status: "idle",
					updatedAt: "2026-07-11T01:00:00.000Z",
				}),
			]);

			expect(discovered.status).toBe("not_loaded");
			expect(updated).toMatchObject({
				id: "a",
				name: "Renamed",
				preview: "Updated preview",
				status: "idle",
				tagScore: 3,
			});
			expect(store.countThreads()).toBe(1);
		} finally {
			store.close();
		}
	});

	it("preserves known subagent identity when a partial search result omits it", () => {
		const store = Store.open(":memory:");
		try {
			reconcileRuntimeThreads(store, [
				runtimeThread("child", {
					parentThreadId: "parent",
					sourceKind: "subagent",
					agentNickname: "Goodall",
					agentRole: "Research",
				}),
			]);

			reconcileRuntimeThreads(store, [
				runtimeThread("child", { sourceKind: "unknown" }),
			]);

			expect(store.getThread("child")).toMatchObject({
				parentThreadId: "parent",
				sourceKind: "subagent",
				agentNickname: "Goodall",
				agentRole: "Research",
			});
		} finally {
			store.close();
		}
	});

	it("restores fork lineage when parent and child arrive together", () => {
		const store = Store.open(":memory:");
		try {
			const threads = reconcileRuntimeThreads(store, [
				runtimeThread("child", { forkedFromId: "parent" }),
				runtimeThread("parent"),
			]);

			expect(
				threads.find((thread) => thread.id === "child")?.forkedFromId,
			).toBe("parent");
		} finally {
			store.close();
		}
	});

	it("persists a latest turn window and updates repeated snapshots", () => {
		const store = Store.open(":memory:");
		try {
			reconcileRuntimeThreads(store, [runtimeThread("a")]);
			const history = {
				turns: [
					{
						id: "turn-a",
						status: "completed" as const,
						prompt: "prompt",
						startedAt: "2026-07-11T00:00:00.000Z",
						completedAt: "2026-07-11T00:00:01.000Z",
						durationMs: 1000,
						items: [
							{
								id: "item-a",
								type: "agent" as const,
								text: "first",
								data: { sourceType: "agentMessage" },
								createdAt: "2026-07-11T00:00:00.000Z",
							},
						],
					},
				],
				nextCursor: null,
			};

			reconcileRuntimeThreadHistory(store, "a", history);
			reconcileRuntimeThreadHistory(store, "a", {
				...history,
				turns: [
					{
						...history.turns[0],
						items: [{ ...history.turns[0].items[0], text: "updated" }],
					},
				],
			});

			expect(store.listTurns("a")).toHaveLength(1);
			expect(store.listThreadItemsPage("a").items).toMatchObject([
				{ id: "item-a", text: "updated", turnId: "turn-a" },
			]);
		} finally {
			store.close();
		}
	});

	it("scopes rollout-local item ids to their thread and turn", () => {
		const store = Store.open(":memory:");
		try {
			reconcileRuntimeThreads(store, [runtimeThread("a"), runtimeThread("b")]);
			store.createTurn({
				id: "turn-a",
				threadId: "a",
				status: "completed",
				prompt: "prompt a",
				startedAt: "2026-07-11T00:00:00.000Z",
				completedAt: "2026-07-11T00:00:01.000Z",
				durationMs: 1000,
			});
			store.createItem({
				id: "item-1",
				threadId: "a",
				turnId: "turn-a",
				type: "user",
				text: "prompt a",
				data: { sourceType: "userMessage" },
				createdAt: "2026-07-11T00:00:00.000Z",
			});
			const reconcile = (threadId: string) => {
				reconcileRuntimeThreadHistory(store, threadId, {
					turns: [
						{
							id: `turn-${threadId}`,
							status: "completed",
							prompt: `prompt ${threadId}`,
							startedAt: "2026-07-11T00:00:00.000Z",
							completedAt: "2026-07-11T00:00:01.000Z",
							durationMs: 1000,
							items: [
								{
									id: "item-1",
									type: "user",
									text: `prompt ${threadId}`,
									data: { sourceType: "userMessage" },
									createdAt: "2026-07-11T00:00:00.000Z",
								},
							],
						},
					],
					nextCursor: null,
				});
			};

			reconcile("b");
			expect(store.getItem("item-1")).toMatchObject({
				threadId: "a",
				turnId: "turn-a",
			});
			reconcile("a");

			expect(store.listTurnItems("turn-a")).toMatchObject([
				{ id: "history:a:turn-a:item-1", text: "prompt a" },
			]);
			expect(store.listTurnItems("turn-b")).toMatchObject([
				{ id: "history:b:turn-b:item-1", text: "prompt b" },
			]);
			expect(store.getItem("item-1")).toBeNull();
		} finally {
			store.close();
		}
	});

	it("keeps the live prompt item when history uses a rollout-local id", () => {
		const store = Store.open(":memory:");
		try {
			reconcileRuntimeThreads(store, [runtimeThread("a")]);
			store.createTurn({
				id: "turn-a",
				threadId: "a",
				status: "completed",
				prompt: "same prompt",
				startedAt: "2026-07-11T00:00:00.000Z",
				completedAt: "2026-07-11T00:00:01.000Z",
				durationMs: 1000,
			});
			store.createItem({
				id: "item-1",
				threadId: "a",
				turnId: "turn-a",
				type: "user",
				text: "same prompt",
				data: { sourceType: "userMessage" },
				createdAt: "2026-07-10T19:00:00.000Z",
			});
			store.createItem({
				id: "019f4fb1-fc79-7401-bcd2-345658ae5173",
				threadId: "a",
				turnId: "turn-a",
				type: "user",
				text: "same prompt",
				data: { sourceType: "userMessage" },
				createdAt: "2026-07-11T00:00:00.006Z",
			});

			reconcileRuntimeThreadHistory(store, "a", {
				turns: [
					{
						id: "turn-a",
						status: "completed",
						prompt: "same prompt",
						startedAt: "2026-07-11T00:00:00.000Z",
						completedAt: "2026-07-11T00:00:01.000Z",
						durationMs: 1000,
						items: [
							{
								id: "item-1",
								type: "user",
								text: "same prompt",
								data: { sourceType: "userMessage" },
								createdAt: "2026-07-11T00:00:00.000Z",
							},
						],
					},
				],
				nextCursor: null,
			});

			expect(store.listTurnItems("turn-a")).toMatchObject([
				{
					id: "019f4fb1-fc79-7401-bcd2-345658ae5173",
					text: "same prompt",
				},
			]);
			expect(store.getItem("item-1")).toBeNull();
			expect(store.getItem("history:a:turn-a:item-1")).toBeNull();
		} finally {
			store.close();
		}
	});
});
