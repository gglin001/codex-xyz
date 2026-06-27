import type {
	ControlThread,
	CozEvent,
	DashboardState,
	ItemType,
	ThreadDetail,
	ThreadItem,
	Turn,
} from "../server/domain.js";
import {
	isThreadRuntimeStatus,
	isTurnStatus,
	threadRuntimeStatusFromTurnStatus,
} from "../server/domain.js";
import {
	isOptimisticItem,
	isOptimisticTurnId,
	rebaseOptimisticTurnDetail,
} from "./optimisticThreads.js";

export type ClientProjection = {
	state: DashboardState;
	detail: ThreadDetail | null;
};

export type ProjectionResult = ClientProjection & {
	changed: boolean;
	handled: boolean;
	needsRefresh: boolean;
};

export const incrementalEventNames = [
	"item.created",
	"item.updated",
	"item.delta",
	"turn.started",
	"turn.status",
	"turn.steered",
	"turn.interrupt.requested",
	"thread.started",
	"thread.resumed",
	"thread.status",
	"thread.runtime_lost",
	"thread.forked",
	"thread.archived",
	"thread.name.updated",
	"thread.goal.updated",
	"thread.goal.cleared",
	"thread.tag.updated",
	"thread.token_usage",
] as const;

const threadPayloadEventNames = new Set([
	"thread.started",
	"thread.resumed",
	"thread.runtime_lost",
	"thread.forked",
	"thread.name.updated",
	"thread.goal.updated",
	"thread.goal.cleared",
	"thread.tag.updated",
	"thread.token_usage",
]);

const insertedThreadEventNames = new Set(["thread.started", "thread.forked"]);
const refreshThreadEventNames = new Set([
	"thread.started",
	"thread.forked",
	"thread.archived",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object";
}

function isThreadPayloadEvent(type: string) {
	return threadPayloadEventNames.has(type);
}

function isInsertedThreadEvent(type: string) {
	return insertedThreadEventNames.has(type);
}

function payloadRecord(event: CozEvent) {
	return isRecord(event.payload) ? event.payload : {};
}

function payloadValue<T>(event: CozEvent, key: string) {
	const value = payloadRecord(event)[key];
	return isRecord(value) ? (value as T) : null;
}

function hasPayloadRecord(event: CozEvent, key: string) {
	return isRecord(payloadRecord(event)[key]);
}

function shallowEqualValue(a: unknown, b: unknown): boolean {
	if (a === b) {
		return true;
	}
	if (Array.isArray(a) && Array.isArray(b)) {
		return (
			a.length === b.length && a.every((value, index) => value === b[index])
		);
	}
	if (isRecord(a) && isRecord(b)) {
		return shallowEqualObject(a, b);
	}
	return false;
}

function shallowEqualObject<T extends object>(a: T, b: T) {
	const aEntries = Object.entries(a) as [keyof T, T[keyof T]][];
	const bKeys = Object.keys(b);
	if (aEntries.length !== bKeys.length) {
		return false;
	}
	return aEntries.every(([key, value]) => shallowEqualValue(value, b[key]));
}

function findIndexById<T extends { id: string }>(
	items: T[],
	itemId: string,
	searchFromEnd: boolean,
) {
	if (searchFromEnd) {
		for (let index = items.length - 1; index >= 0; index -= 1) {
			if (items[index].id === itemId) {
				return index;
			}
		}
		return -1;
	}
	for (let index = 0; index < items.length; index += 1) {
		if (items[index].id === itemId) {
			return index;
		}
	}
	return -1;
}

function upsertById<T extends { id: string }>(
	items: T[],
	item: T,
	options: {
		prepend?: boolean;
		equal?: (a: T, b: T) => boolean;
		searchFromEnd?: boolean;
	} = {},
) {
	const index = findIndexById(items, item.id, Boolean(options.searchFromEnd));
	if (index === -1) {
		return options.prepend ? [item, ...items] : [...items, item];
	}
	if (items[index] === item || options.equal?.(items[index], item)) {
		return items;
	}
	const next = [...items];
	next[index] = item;
	return next;
}

function mergeIfChanged<T extends object>(item: T, updates: Partial<T>) {
	let changed = false;
	for (const [key, value] of Object.entries(updates) as [
		keyof T,
		T[keyof T],
	][]) {
		if (item[key] !== value) {
			changed = true;
			break;
		}
	}
	return changed ? { ...item, ...updates } : item;
}

function updateById<T extends { id: string }>(
	items: T[],
	itemId: string,
	update: (item: T) => T,
) {
	const index = items.findIndex((candidate) => candidate.id === itemId);
	if (index === -1) {
		return items;
	}
	const nextItem = update(items[index]);
	if (nextItem === items[index]) {
		return items;
	}
	const next = [...items];
	next[index] = nextItem;
	return next;
}

function nextThreadCursor(threads: ControlThread[], hasMore: boolean) {
	const thread = hasMore ? threads.at(-1) : null;
	return thread ? { updatedAt: thread.updatedAt, id: thread.id } : null;
}

function withThread(
	projection: ClientProjection,
	thread: ControlThread,
	options: {
		insertIfMissing?: boolean;
		countInsert?: boolean;
	} = {},
): ClientProjection {
	const existingIndex = projection.state.threads.findIndex(
		(candidate) => candidate.id === thread.id,
	);
	const missing = existingIndex === -1;
	if (missing && options.insertIfMissing === false) {
		const detail =
			projection.detail?.id === thread.id
				? mergeIfChanged<ThreadDetail>(
						projection.detail,
						thread as Partial<ThreadDetail>,
					)
				: projection.detail;
		return detail === projection.detail
			? projection
			: { ...projection, detail };
	}
	const threads = upsertById(projection.state.threads, thread, {
		prepend: true,
		equal: shallowEqualObject,
	});
	const threadTotalCount =
		missing && options.countInsert === true
			? projection.state.threadTotalCount + 1
			: projection.state.threadTotalCount;
	const threadHasMore = threads.length < threadTotalCount;
	const detail =
		projection.detail?.id === thread.id
			? mergeIfChanged<ThreadDetail>(
					projection.detail,
					thread as Partial<ThreadDetail>,
				)
			: projection.detail;
	if (
		threads === projection.state.threads &&
		detail === projection.detail &&
		threadTotalCount === projection.state.threadTotalCount
	) {
		return projection;
	}
	return {
		state:
			threads === projection.state.threads &&
			threadTotalCount === projection.state.threadTotalCount
				? projection.state
				: {
						...projection.state,
						threads,
						threadTotalCount,
						threadNextCursor: nextThreadCursor(threads, threadHasMore),
						threadHasMore,
					},
		detail,
	};
}

function withThreadFields(
	projection: ClientProjection,
	threadId: string,
	updates: Partial<ControlThread>,
): ClientProjection {
	const threads = updateById(projection.state.threads, threadId, (thread) =>
		mergeIfChanged<ControlThread>(thread, updates),
	);
	const detail =
		projection.detail?.id === threadId
			? mergeIfChanged<ThreadDetail>(
					projection.detail,
					updates as Partial<ThreadDetail>,
				)
			: projection.detail;
	if (threads === projection.state.threads && detail === projection.detail) {
		return projection;
	}
	return {
		state:
			threads === projection.state.threads
				? projection.state
				: { ...projection.state, threads },
		detail,
	};
}

function withoutThread(
	projection: ClientProjection,
	threadId: string,
): ClientProjection {
	const existing = projection.state.threads.some(
		(thread) => thread.id === threadId,
	);
	const detail = projection.detail?.id === threadId ? null : projection.detail;
	if (!existing && detail === projection.detail) {
		return projection;
	}
	const threads = projection.state.threads.filter(
		(thread) => thread.id !== threadId,
	);
	const removedLoadedThread = existing ? 1 : 0;
	const threadTotalCount = Math.max(
		0,
		projection.state.threadTotalCount - removedLoadedThread,
	);
	const threadHasMore = threads.length < threadTotalCount;
	return {
		state: {
			...projection.state,
			threads,
			threadTotalCount,
			threadNextCursor: nextThreadCursor(threads, threadHasMore),
			threadHasMore,
		},
		detail,
	};
}

function withTurn(projection: ClientProjection, turn: Turn): ClientProjection {
	if (projection.detail?.id !== turn.threadId) {
		return projection;
	}
	const optimisticTurn = projection.detail.turns.find(
		(candidate) =>
			isOptimisticTurnId(candidate.id) && candidate.prompt === turn.prompt,
	);
	if (optimisticTurn) {
		return {
			...projection,
			detail: rebaseOptimisticTurnDetail(projection.detail, {
				optimisticTurnId: optimisticTurn.id,
				turn,
			}),
		};
	}
	const turns = upsertById(projection.detail.turns, turn, {
		equal: shallowEqualObject,
	});
	if (turns === projection.detail.turns) {
		return projection;
	}
	return {
		...projection,
		detail: {
			...projection.detail,
			turns,
		},
	};
}

function withTurnFields(
	projection: ClientProjection,
	threadId: string,
	turnId: string,
	updates: Partial<Turn>,
): ClientProjection {
	if (projection.detail?.id !== threadId) {
		return projection;
	}
	const turns = updateById(projection.detail.turns, turnId, (turn) =>
		mergeIfChanged<Turn>(turn, updates),
	);
	if (turns === projection.detail.turns) {
		return projection;
	}
	return {
		...projection,
		detail: {
			...projection.detail,
			turns,
		},
	};
}

function withThreadItem(
	projection: ClientProjection,
	item: ThreadItem,
): ClientProjection {
	if (projection.detail?.id !== item.threadId) {
		return projection;
	}
	const matchingOptimisticItemIndex = projection.detail.items.findIndex(
		(candidate) =>
			isOptimisticItem(candidate) &&
			candidate.type === item.type &&
			candidate.text === item.text &&
			candidate.threadId === item.threadId &&
			candidate.turnId === item.turnId,
	);
	if (matchingOptimisticItemIndex !== -1) {
		const items = [...projection.detail.items];
		items[matchingOptimisticItemIndex] = item;
		return {
			...projection,
			detail: {
				...projection.detail,
				items,
			},
		};
	}
	const items = upsertById(projection.detail.items, item, {
		equal: shallowEqualObject,
		searchFromEnd: true,
	});
	if (items === projection.detail.items) {
		return projection;
	}
	return {
		...projection,
		detail: {
			...projection.detail,
			items,
		},
	};
}

function deltaItemType(value: unknown): ItemType {
	if (
		value === "user" ||
		value === "agent" ||
		value === "plan" ||
		value === "command" ||
		value === "file" ||
		value === "system"
	) {
		return value;
	}
	return "agent";
}

function withThreadItemDelta(
	projection: ClientProjection,
	event: CozEvent,
): ClientProjection | null {
	if (!event.threadId) {
		return null;
	}
	if (!projection.detail || projection.detail.id !== event.threadId) {
		return projection;
	}
	const payload = payloadRecord(event);
	const itemId = payload.itemId;
	const delta = payload.delta;
	if (typeof itemId !== "string" || typeof delta !== "string") {
		return null;
	}
	const itemType = deltaItemType(payload.itemType);
	const existing = projection.detail.items.find((item) => item.id === itemId);
	const item = existing
		? { ...existing, text: `${existing.text}${delta}` }
		: {
				id: itemId,
				threadId: event.threadId,
				turnId: event.turnId,
				type: itemType,
				text: delta,
				data: { synthesized: true },
				createdAt: event.createdAt,
			};
	return withThreadItem(projection, item);
}

function result(
	previous: ClientProjection,
	projection: ClientProjection,
	handled: boolean,
	event: CozEvent,
): ProjectionResult {
	return {
		...projection,
		changed:
			previous.state !== projection.state ||
			previous.detail !== projection.detail,
		handled,
		needsRefresh: refreshThreadEventNames.has(event.type),
	};
}

export function applyEventProjection(
	projection: ClientProjection,
	event: CozEvent,
): ProjectionResult {
	const thread = payloadValue<ControlThread>(event, "thread");
	if (thread && isThreadPayloadEvent(event.type)) {
		const isNewThreadEvent = isInsertedThreadEvent(event.type);
		return result(
			projection,
			withThread(projection, thread, {
				insertIfMissing: isNewThreadEvent,
				countInsert: isNewThreadEvent,
			}),
			true,
			event,
		);
	}

	if (event.type === "turn.started") {
		const turn = payloadValue<Turn>(event, "turn");
		if (!turn) {
			return result(projection, projection, false, event);
		}
		const updates: Partial<ControlThread> = {
			status: "active",
			activeTurnId: turn.id,
			lastTurnStatus: "in_progress",
			updatedAt: turn.startedAt,
		};
		if (turn.prompt) {
			updates.preview = turn.prompt;
		}
		const next = withThreadFields(
			withTurn(projection, turn),
			turn.threadId,
			updates,
		);
		return result(projection, next, true, event);
	}

	if (event.type === "turn.status") {
		const status = payloadRecord(event).status;
		if (!event.threadId || !event.turnId || !isTurnStatus(status)) {
			return result(projection, projection, false, event);
		}
		const completedAt = status === "in_progress" ? null : event.createdAt;
		const next = withThreadFields(
			withTurnFields(projection, event.threadId, event.turnId, {
				status,
				completedAt,
			}),
			event.threadId,
			{
				status: threadRuntimeStatusFromTurnStatus(status),
				activeTurnId: status === "in_progress" ? event.turnId : null,
				lastTurnStatus: status,
				updatedAt: event.createdAt,
			},
		);
		return result(projection, next, true, event);
	}

	if (event.type === "thread.status") {
		const status = payloadRecord(event).status;
		if (!event.threadId || !isThreadRuntimeStatus(status)) {
			return result(projection, projection, false, event);
		}
		const thread = payloadValue<ControlThread>(event, "thread");
		if (thread) {
			return result(
				projection,
				withThread(projection, thread, { insertIfMissing: false }),
				true,
				event,
			);
		}
		const updates: Partial<ControlThread> = {
			status,
			updatedAt: event.createdAt,
		};
		if (status !== "active") {
			updates.activeTurnId = null;
		}
		return result(
			projection,
			withThreadFields(projection, event.threadId, updates),
			true,
			event,
		);
	}

	if (event.type === "thread.archived") {
		if (!event.threadId) {
			return result(projection, projection, false, event);
		}
		return result(
			projection,
			withoutThread(projection, event.threadId),
			true,
			event,
		);
	}

	if (event.type === "item.delta") {
		const next = withThreadItemDelta(projection, event);
		if (!next) {
			return result(projection, projection, false, event);
		}
		return result(projection, next, true, event);
	}

	if (event.type === "item.created" || event.type === "item.updated") {
		const item = payloadValue<ThreadItem>(event, "item");
		if (!item) {
			const projected = result(
				projection,
				projection,
				hasPayloadRecord(event, "itemRef"),
				event,
			);
			return hasPayloadRecord(event, "itemRef")
				? { ...projected, needsRefresh: true }
				: projected;
		}
		return result(projection, withThreadItem(projection, item), true, event);
	}

	return result(
		projection,
		projection,
		event.type === "turn.steered" || event.type === "turn.interrupt.requested",
		event,
	);
}

export function applyEventProjectionBatch(
	projection: ClientProjection,
	events: CozEvent[],
): ProjectionResult {
	let nextProjection = projection;
	let changed = false;
	let handled = true;
	let needsRefresh = false;

	for (const event of events) {
		const next = applyEventProjection(nextProjection, event);
		nextProjection = {
			state: next.state,
			detail: next.detail,
		};
		changed = changed || next.changed;
		handled = handled && next.handled;
		needsRefresh = needsRefresh || next.needsRefresh;
	}

	return {
		...nextProjection,
		changed,
		handled,
		needsRefresh,
	};
}
