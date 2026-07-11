import type {
	RuntimeThreadHistorySnapshot,
	RuntimeThreadSnapshot,
} from "./codex/runtimePort.js";
import type { ControlThread } from "./domain.js";
import { nowIso } from "./domain.js";
import type { Store } from "./store.js";

const rolloutLocalItemIdPattern = /^item-\d+$/;

function persistedHistoryItemId(
	threadId: string,
	turnId: string,
	itemId: string,
) {
	return rolloutLocalItemIdPattern.test(itemId)
		? `history:${threadId}:${turnId}:${itemId}`
		: itemId;
}

function isRolloutLocalHistoryItemId(itemId: string) {
	return (
		rolloutLocalItemIdPattern.test(itemId) || itemId.startsWith("history:")
	);
}

function discoveredThread(
	store: Store,
	runtimeThread: RuntimeThreadSnapshot,
	archived: boolean,
): ControlThread {
	const existing = store.getThread(runtimeThread.id);
	const updatedAt = runtimeThread.updatedAt ?? existing?.updatedAt ?? nowIso();
	return {
		id: runtimeThread.id,
		sessionId: runtimeThread.sessionId,
		forkedFromId:
			runtimeThread.forkedFromId && store.getThread(runtimeThread.forkedFromId)
				? runtimeThread.forkedFromId
				: null,
		name:
			runtimeThread.name?.trim() ||
			existing?.name ||
			runtimeThread.preview ||
			"Untitled thread",
		preview: runtimeThread.preview || existing?.preview || "",
		cwd: runtimeThread.cwd,
		model: runtimeThread.model ?? existing?.model ?? null,
		status: runtimeThread.status,
		activeTurnId:
			runtimeThread.status === "active"
				? (runtimeThread.activeTurnId ?? null)
				: null,
		lastTurnStatus:
			runtimeThread.status === "active"
				? "in_progress"
				: (existing?.lastTurnStatus ?? null),
		goalObjective: existing?.goalObjective ?? null,
		goalStatus: existing?.goalStatus ?? null,
		goalTokenBudget: existing?.goalTokenBudget ?? null,
		tokensUsed: existing?.tokensUsed ?? 0,
		tagScore: existing?.tagScore ?? null,
		archivedAt: archived ? (existing?.archivedAt ?? updatedAt) : null,
		createdAt: existing?.createdAt ?? updatedAt,
		updatedAt,
	};
}

export function reconcileRuntimeThreads(
	store: Store,
	runtimeThreads: RuntimeThreadSnapshot[],
	options: { archived?: boolean | null } = {},
) {
	return store.transaction(() => {
		let discovered = runtimeThreads.map((thread) =>
			discoveredThread(store, thread, options.archived === true),
		);
		for (const thread of discovered) {
			store.upsertDiscoveredThread(thread);
		}
		discovered = runtimeThreads.map((thread) =>
			discoveredThread(store, thread, options.archived === true),
		);
		for (const thread of discovered) {
			store.upsertDiscoveredThread(thread);
		}
		return discovered.map((thread) => store.getThread(thread.id) ?? thread);
	});
}

export function reconcileRuntimeThreadHistory(
	store: Store,
	threadId: string,
	history: RuntimeThreadHistorySnapshot,
) {
	store.transaction(() => {
		for (const runtimeTurn of [...history.turns].reverse()) {
			const existing = store.getTurn(runtimeTurn.id);
			if (existing) {
				store.updateTurn(runtimeTurn.id, {
					status: runtimeTurn.status,
					prompt: runtimeTurn.prompt,
					completedAt: runtimeTurn.completedAt,
					durationMs: runtimeTurn.durationMs,
				});
			} else {
				store.createTurn({
					id: runtimeTurn.id,
					threadId,
					status: runtimeTurn.status,
					prompt: runtimeTurn.prompt,
					startedAt: runtimeTurn.startedAt,
					completedAt: runtimeTurn.completedAt,
					durationMs: runtimeTurn.durationMs,
				});
			}
			const existingItems = store.listTurnItems(runtimeTurn.id);
			const promptItem = runtimeTurn.items.find(
				(item) => item.type === "user" && item.text === runtimeTurn.prompt,
			);
			for (const item of runtimeTurn.items) {
				const persistedId = persistedHistoryItemId(
					threadId,
					runtimeTurn.id,
					item.id,
				);
				if (rolloutLocalItemIdPattern.test(item.id)) {
					const legacyItem = store.getItem(item.id);
					if (legacyItem?.turnId === runtimeTurn.id) {
						store.deleteItem(item.id);
					}
				}
				if (item === promptItem) {
					const matchingLivePrompt = existingItems.find(
						(existingItem) =>
							existingItem.type === "user" &&
							existingItem.text === item.text &&
							!isRolloutLocalHistoryItemId(existingItem.id),
					);
					if (matchingLivePrompt) {
						for (const existingItem of existingItems) {
							if (
								existingItem.type === "user" &&
								existingItem.text === item.text &&
								isRolloutLocalHistoryItemId(existingItem.id)
							) {
								store.deleteItem(existingItem.id);
							}
						}
						continue;
					}
				}
				store.upsertItem({
					...item,
					id: persistedId,
					threadId,
					turnId: runtimeTurn.id,
				});
			}
		}
	});
}
