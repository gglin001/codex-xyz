import type {
	ControlThread,
	DashboardState,
	ThreadDetail,
	ThreadItem,
	Turn,
} from "../server/domain.js";
import { threadNameFromPrompt } from "../server/domain.js";

const optimisticThreadPrefix = "optimistic-thread-";

export function createOptimisticThreadId() {
	const randomId =
		typeof globalThis.crypto?.randomUUID === "function"
			? globalThis.crypto.randomUUID()
			: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
	return `${optimisticThreadPrefix}${randomId}`;
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
