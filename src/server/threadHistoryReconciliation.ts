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
	context?: { generation: number; runtimeEpoch: number },
): ControlThread {
	const existing = store.getThread(runtimeThread.id);
	const preservedActiveTurnId =
		existing?.activeTurnId &&
		store.getTurn(existing.activeTurnId)?.status === "in_progress"
			? existing.activeTurnId
			: (store
					.listTurns(runtimeThread.id)
					.filter((turn) => turn.status === "in_progress")
					.at(-1)?.id ?? null);
	const observedAt = nowIso();
	const updatedAt =
		runtimeThread.updatedAt ?? existing?.updatedAt ?? observedAt;
	return {
		id: runtimeThread.id,
		sessionId: runtimeThread.sessionId,
		forkedFromId:
			runtimeThread.forkedFromId && store.getThread(runtimeThread.forkedFromId)
				? runtimeThread.forkedFromId
				: null,
		parentThreadId: runtimeThread.parentThreadId,
		sourceKind: runtimeThread.sourceKind,
		agentNickname: runtimeThread.agentNickname,
		agentRole: runtimeThread.agentRole,
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
				? (runtimeThread.activeTurnId ?? preservedActiveTurnId)
				: null,
		lastTurnStatus:
			runtimeThread.status === "active"
				? "in_progress"
				: (existing?.lastTurnStatus ?? null),
		goalObjective: existing?.goalObjective ?? null,
		goalStatus: existing?.goalStatus ?? null,
		goalTokenBudget: existing?.goalTokenBudget ?? null,
		tokensUsed: existing?.tokensUsed ?? 0,
		contextWindow: existing?.contextWindow ?? null,
		tagScore: existing?.tagScore ?? null,
		lifecycleState:
			existing?.lifecycleState ?? (archived ? "archived" : "active"),
		desiredArchived: existing?.desiredArchived ?? archived,
		remoteArchived: existing?.remoteArchived ?? archived,
		remoteObservedAt: existing?.remoteObservedAt ?? observedAt,
		remoteUpdatedAt:
			runtimeThread.updatedAt ?? existing?.remoteUpdatedAt ?? null,
		localUpdatedAt: existing?.localUpdatedAt ?? observedAt,
		runtimeSeenAt: observedAt,
		runtimeEpoch: context?.runtimeEpoch ?? existing?.runtimeEpoch ?? 0,
		syncGeneration: context?.generation ?? existing?.syncGeneration ?? 0,
		stateRevision: existing?.stateRevision ?? 0,
		lastOperationError: existing?.lastOperationError ?? null,
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

export function reconcileRuntimeThreadSnapshot(
	store: Store,
	input: {
		active: RuntimeThreadSnapshot[];
		archived: RuntimeThreadSnapshot[];
		generation: number;
		baseRevision: number;
		runtimeEpoch: number;
	},
) {
	const activeIds = new Set(input.active.map((thread) => thread.id));
	const overlappingThread = input.archived.find((thread) =>
		activeIds.has(thread.id),
	);
	if (overlappingThread) {
		throw new Error(
			`Codex returned thread ${overlappingThread.id} in both active and archived snapshots`,
		);
	}
	const before = new Map(
		store
			.listThreads({ includeAll: true })
			.map((thread) => [thread.id, threadSnapshotValue(thread)]),
	);
	const observedIds = new Set([
		...input.active.map((thread) => thread.id),
		...input.archived.map((thread) => thread.id),
	]);
	return store.transaction(() => {
		if (store.getThreadRuntimeEpoch() !== input.runtimeEpoch) {
			throw new Error(
				"Codex thread snapshot belongs to an older runtime epoch",
			);
		}
		for (const [archived, runtimeThreads] of [
			[false, input.active],
			[true, input.archived],
		] as const) {
			for (const runtimeThread of runtimeThreads) {
				const discovered = discoveredThread(store, runtimeThread, archived, {
					generation: input.generation,
					runtimeEpoch: input.runtimeEpoch,
				});
				store.upsertDiscoveredThread(discovered, {
					generation: input.generation,
					baseRevision: input.baseRevision,
					runtimeEpoch: input.runtimeEpoch,
				});
				store.applyThreadRemoteState(runtimeThread.id, {
					archived,
					remoteUpdatedAt: runtimeThread.updatedAt,
					generation: input.generation,
					baseRevision: input.baseRevision,
					runtimeSeenAt: discovered.runtimeSeenAt,
					runtimeEpoch: input.runtimeEpoch,
				});
			}
		}
		for (const thread of store.listThreads({ includeAll: true })) {
			if (!observedIds.has(thread.id)) {
				store.markThreadMissing(
					thread.id,
					input.generation,
					input.baseRevision,
				);
			}
		}
		const after = new Map(
			store
				.listThreads({ includeAll: true })
				.map((thread) => [thread.id, threadSnapshotValue(thread)]),
		);
		return {
			active: input.active.map((thread) => store.getThread(thread.id)),
			archived: input.archived.map((thread) => store.getThread(thread.id)),
			changed:
				before.size !== after.size ||
				[...after].some(([id, value]) => before.get(id) !== value),
		};
	});
}

function threadSnapshotValue(thread: ControlThread) {
	const {
		remoteObservedAt: _remoteObservedAt,
		remoteUpdatedAt: _remoteUpdatedAt,
		localUpdatedAt: _localUpdatedAt,
		runtimeSeenAt: _runtimeSeenAt,
		runtimeEpoch: _runtimeEpoch,
		syncGeneration: _syncGeneration,
		stateRevision: _stateRevision,
		...visible
	} = thread;
	return JSON.stringify(visible);
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
