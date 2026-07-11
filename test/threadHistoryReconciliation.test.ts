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
});
