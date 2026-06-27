import type {
	ControlThread,
	DashboardState,
	ThreadDetail,
	ThreadItem,
	Turn,
} from "../server/domain.js";
import { threadNameFromPrompt } from "../server/domain.js";

const optimisticThreadPrefix = "optimistic-thread-";
const optimisticTurnPrefix = "optimistic-turn-";
const optimisticItemPrefix = "optimistic-item-";

export function createOptimisticThreadId() {
	const randomId =
		typeof globalThis.crypto?.randomUUID === "function"
			? globalThis.crypto.randomUUID()
			: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
	return `${optimisticThreadPrefix}${randomId}`;
}

function createOptimisticId(prefix: string) {
	const randomId =
		typeof globalThis.crypto?.randomUUID === "function"
			? globalThis.crypto.randomUUID()
			: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
	return `${prefix}${randomId}`;
}

export function isOptimisticTurnId(turnId: string | null | undefined) {
	return Boolean(turnId?.startsWith("optimistic-"));
}

export function isOptimisticItem(item: Pick<ThreadItem, "data">) {
	return item.data.optimistic === true;
}

export function shouldResolveOptimisticThread(
	pending: Pick<ControlThread, "cwd" | "name" | "createdAt">,
	thread: Pick<ControlThread, "cwd" | "name" | "createdAt">,
) {
	return (
		thread.cwd === pending.cwd &&
		thread.name === pending.name &&
		thread.createdAt >= pending.createdAt
	);
}

function nextThreadCursor(threads: ControlThread[], hasMore: boolean) {
	const thread = hasMore ? threads.at(-1) : null;
	return thread ? { updatedAt: thread.updatedAt, id: thread.id } : null;
}

function threadHasMore(threads: ControlThread[], threadTotalCount: number) {
	return threads.length < threadTotalCount;
}

export function createOptimisticThreadDraft(input: {
	id: string;
	cwd: string;
	prompt: string;
	goalMode: boolean;
	model: string | null;
	latestEventId: number;
	now?: string;
}) {
	const now = input.now ?? new Date().toISOString();
	const name = threadNameFromPrompt(input.prompt);
	const turnId = `${input.id}:turn`;
	const thread: ControlThread = {
		id: input.id,
		sessionId: input.id,
		forkedFromId: null,
		name,
		preview: name,
		cwd: input.cwd,
		model: input.model,
		status: "active",
		activeTurnId: turnId,
		lastTurnStatus: "in_progress",
		goalObjective: input.goalMode ? input.prompt : null,
		goalStatus: input.goalMode ? "in_progress" : null,
		goalTokenBudget: null,
		tokensUsed: 0,
		tagScore: null,
		archivedAt: null,
		createdAt: now,
		updatedAt: now,
	};
	const turn: Turn = {
		id: turnId,
		threadId: thread.id,
		status: "in_progress",
		prompt: input.goalMode ? "" : input.prompt,
		startedAt: now,
		completedAt: null,
		durationMs: null,
	};
	const promptItem: ThreadItem = {
		id: `${input.id}:prompt`,
		threadId: thread.id,
		turnId,
		type: "user",
		text: input.prompt,
		data: {
			optimistic: true,
			goalMode: input.goalMode,
		},
		createdAt: now,
	};
	const detail: ThreadDetail = {
		...thread,
		turns: [turn],
		items: [promptItem],
		itemTotalCount: 1,
		itemPageSize: 1,
		itemNextCursor: null,
		itemHasMore: false,
		latestEventId: input.latestEventId,
	};
	return { thread, detail };
}

export function createOptimisticTurnDraft(input: {
	thread: ControlThread;
	prompt: string;
	goalMode: boolean;
	now?: string;
}) {
	const now = input.now ?? new Date().toISOString();
	const steeringExistingTurn =
		!input.goalMode &&
		input.thread.status === "active" &&
		Boolean(input.thread.activeTurnId);
	const turnId = steeringExistingTurn
		? (input.thread.activeTurnId as string)
		: createOptimisticId(optimisticTurnPrefix);
	const turn: Turn | null = steeringExistingTurn
		? null
		: {
				id: turnId,
				threadId: input.thread.id,
				status: "in_progress",
				prompt: input.goalMode ? "" : input.prompt,
				startedAt: now,
				completedAt: null,
				durationMs: null,
			};
	const item: ThreadItem = {
		id: createOptimisticId(optimisticItemPrefix),
		threadId: input.thread.id,
		turnId,
		type: "user",
		text: input.prompt,
		data: {
			optimistic: true,
			steer: steeringExistingTurn,
			goalMode: input.goalMode,
			optimisticTurnId: turnId,
		},
		createdAt: now,
	};
	const thread: ControlThread = {
		...input.thread,
		status: "active",
		activeTurnId: turnId,
		lastTurnStatus: "in_progress",
		preview: input.goalMode ? input.thread.preview : input.prompt,
		goalObjective: input.goalMode ? input.prompt : input.thread.goalObjective,
		goalStatus: input.goalMode ? "in_progress" : input.thread.goalStatus,
		goalTokenBudget: input.goalMode ? null : input.thread.goalTokenBudget,
		updatedAt: now,
	};
	return {
		thread,
		turn,
		item,
		turnId,
		itemId: item.id,
		steeringExistingTurn,
	};
}

export function insertOptimisticThreadState(
	state: DashboardState,
	thread: ControlThread,
): DashboardState {
	const existingIndex = state.threads.findIndex(
		(candidate) => candidate.id === thread.id,
	);
	const threads =
		existingIndex === -1
			? [thread, ...state.threads]
			: state.threads.map((candidate) =>
					candidate.id === thread.id ? thread : candidate,
				);
	const threadTotalCount =
		existingIndex === -1 ? state.threadTotalCount + 1 : state.threadTotalCount;
	const hasMore = threadHasMore(threads, threadTotalCount);
	return {
		...state,
		threads,
		threadTotalCount,
		threadNextCursor: nextThreadCursor(threads, hasMore),
		threadHasMore: hasMore,
	};
}

export function restoreThreadState(
	state: DashboardState,
	thread: ControlThread,
): DashboardState {
	const existingIndex = state.threads.findIndex(
		(candidate) => candidate.id === thread.id,
	);
	const threads =
		existingIndex === -1
			? [thread, ...state.threads]
			: state.threads.map((candidate) =>
					candidate.id === thread.id ? thread : candidate,
				);
	const threadTotalCount =
		existingIndex === -1 ? state.threadTotalCount + 1 : state.threadTotalCount;
	const hasMore = threadHasMore(threads, threadTotalCount);
	return {
		...state,
		threads,
		threadTotalCount,
		threadNextCursor: nextThreadCursor(threads, hasMore),
		threadHasMore: hasMore,
	};
}

export function removeOptimisticThreadState(
	state: DashboardState,
	optimisticThreadId: string,
): DashboardState {
	const existing = state.threads.some(
		(thread) => thread.id === optimisticThreadId,
	);
	if (!existing) {
		return state;
	}
	const threads = state.threads.filter(
		(thread) => thread.id !== optimisticThreadId,
	);
	const threadTotalCount = Math.max(0, state.threadTotalCount - 1);
	const hasMore = threadHasMore(threads, threadTotalCount);
	return {
		...state,
		threads,
		threadTotalCount,
		threadNextCursor: nextThreadCursor(threads, hasMore),
		threadHasMore: hasMore,
	};
}

export function replaceOptimisticThreadState(
	state: DashboardState,
	input: {
		optimisticThreadId: string;
		thread: ControlThread;
	},
): DashboardState {
	if (input.optimisticThreadId === input.thread.id) {
		const threads = state.threads.map((candidate) =>
			candidate.id === input.thread.id ? input.thread : candidate,
		);
		const hasMore = threadHasMore(threads, state.threadTotalCount);
		return {
			...state,
			threads,
			threadNextCursor: nextThreadCursor(threads, hasMore),
			threadHasMore: hasMore,
		};
	}

	const hadOptimisticThread = state.threads.some(
		(thread) => thread.id === input.optimisticThreadId,
	);
	const hadRealThread = state.threads.some(
		(thread) => thread.id === input.thread.id,
	);
	const withoutOptimistic = state.threads.filter(
		(thread) => thread.id !== input.optimisticThreadId,
	);
	const threads = hadRealThread
		? withoutOptimistic.map((candidate) =>
				candidate.id === input.thread.id ? input.thread : candidate,
			)
		: [input.thread, ...withoutOptimistic];
	const threadTotalCount =
		state.threadTotalCount +
		(!hadOptimisticThread && !hadRealThread ? 1 : 0) -
		(hadOptimisticThread && hadRealThread ? 1 : 0);
	const hasMore = threadHasMore(threads, threadTotalCount);
	return {
		...state,
		threads,
		threadTotalCount,
		threadNextCursor: nextThreadCursor(threads, hasMore),
		threadHasMore: hasMore,
	};
}

function upsertThreadState(
	state: DashboardState,
	thread: ControlThread,
): DashboardState {
	const index = state.threads.findIndex(
		(candidate) => candidate.id === thread.id,
	);
	if (index === -1) {
		return state;
	}
	if (state.threads[index] === thread) {
		return state;
	}
	const threads = [...state.threads];
	threads[index] = thread;
	return { ...state, threads };
}

export function applyOptimisticTurnDraft(
	projection: {
		state: DashboardState;
		detail: ThreadDetail | null;
	},
	draft: ReturnType<typeof createOptimisticTurnDraft>,
) {
	const state = upsertThreadState(projection.state, draft.thread);
	const detail =
		projection.detail?.id === draft.thread.id
			? {
					...projection.detail,
					...draft.thread,
					turns: draft.turn
						? [...projection.detail.turns, draft.turn]
						: projection.detail.turns,
					items: [...projection.detail.items, draft.item],
					itemTotalCount: projection.detail.itemTotalCount + 1,
					itemPageSize: Math.max(
						projection.detail.itemPageSize,
						projection.detail.items.length + 1,
					),
				}
			: projection.detail;
	return { state, detail };
}

export function resolveOptimisticTurnDraft(
	projection: {
		state: DashboardState;
		detail: ThreadDetail | null;
	},
	input: {
		draft: ReturnType<typeof createOptimisticTurnDraft>;
		turn: Turn;
		thread?: ControlThread | null;
	},
) {
	const thread = input.thread ?? {
		...input.draft.thread,
		activeTurnId: input.turn.status === "in_progress" ? input.turn.id : null,
		status: input.turn.status === "in_progress" ? "active" : "idle",
		lastTurnStatus: input.turn.status,
		updatedAt: input.turn.startedAt,
	};
	const state = upsertThreadState(projection.state, thread);
	const detail =
		projection.detail?.id === input.draft.thread.id
			? input.draft.turn
				? rebaseOptimisticTurnDetail(projection.detail, {
						optimisticTurnId: input.draft.turnId,
						turn: input.turn,
						thread,
					})
				: {
						...projection.detail,
						...thread,
					}
			: projection.detail;
	return { state, detail };
}

export function rollbackOptimisticTurnDraft(
	projection: {
		state: DashboardState;
		detail: ThreadDetail | null;
	},
	input: {
		draft: ReturnType<typeof createOptimisticTurnDraft>;
		previousThread: ControlThread;
	},
) {
	const state = upsertThreadState(projection.state, input.previousThread);
	const detail =
		projection.detail?.id === input.previousThread.id
			? {
					...projection.detail,
					...input.previousThread,
					turns: input.draft.turn
						? projection.detail.turns.filter(
								(turn) => turn.id !== input.draft.turnId,
							)
						: projection.detail.turns,
					items: projection.detail.items.filter(
						(item) => item.id !== input.draft.itemId,
					),
					itemTotalCount: Math.max(
						0,
						projection.detail.itemTotalCount -
							(projection.detail.items.some(
								(item) => item.id === input.draft.itemId,
							)
								? 1
								: 0),
					),
				}
			: projection.detail;
	return { state, detail };
}

export function rebaseOptimisticTurnDetail(
	detail: ThreadDetail,
	input: {
		optimisticTurnId: string;
		turn: Turn;
		thread?: ControlThread | null;
	},
): ThreadDetail {
	const hasRealTurn = detail.turns.some((turn) => turn.id === input.turn.id);
	const turns = hasRealTurn
		? detail.turns.filter((turn) => turn.id !== input.optimisticTurnId)
		: detail.turns.map((turn) =>
				turn.id === input.optimisticTurnId ? input.turn : turn,
			);
	const nextTurns = turns.some((turn) => turn.id === input.turn.id)
		? turns
		: [...turns, input.turn];
	const items = detail.items.map((item) =>
		item.turnId === input.optimisticTurnId
			? { ...item, turnId: input.turn.id }
			: item,
	);
	return {
		...detail,
		...(input.thread ?? {}),
		activeTurnId:
			input.thread?.activeTurnId ??
			(input.turn.status === "in_progress"
				? input.turn.id
				: detail.activeTurnId),
		turns: nextTurns,
		items,
	};
}

export function rebaseOptimisticThreadDetail(
	detail: ThreadDetail | null,
	input: {
		optimisticThreadId: string;
		thread: ControlThread;
		turn: Turn | null;
	},
) {
	if (
		!detail ||
		(detail.id !== input.optimisticThreadId && detail.id !== input.thread.id)
	) {
		return detail;
	}
	const oldTurnId =
		detail.turns.find((turn) => turn.id.startsWith(input.optimisticThreadId))
			?.id ??
		detail.items.find((item) =>
			item.turnId?.startsWith(input.optimisticThreadId),
		)?.turnId ??
		detail.activeTurnId;
	const turnId = input.turn?.id ?? input.thread.activeTurnId ?? oldTurnId;
	const turns = input.turn
		? [
				input.turn,
				...detail.turns
					.filter((turn) => turn.id !== oldTurnId && turn.id !== input.turn?.id)
					.map((turn) => ({ ...turn, threadId: input.thread.id })),
			]
		: detail.turns.map((turn) => ({
				...turn,
				id: turn.id === oldTurnId && turnId ? turnId : turn.id,
				threadId: input.thread.id,
			}));
	const items = detail.items.map((item) => ({
		...item,
		id: item.id.startsWith(input.optimisticThreadId)
			? item.id.replace(input.optimisticThreadId, input.thread.id)
			: item.id,
		threadId: input.thread.id,
		turnId: item.turnId === oldTurnId ? turnId : item.turnId,
	}));
	return {
		...detail,
		...input.thread,
		turns,
		items,
		itemTotalCount: items.length,
		itemPageSize: Math.max(detail.itemPageSize, items.length),
	};
}
