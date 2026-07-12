import type { ControlThread } from "../server/domain.js";

export function choosePreferredThreadId<T extends Pick<ControlThread, "id">>(
	threads: T[],
	options: {
		currentThreadId: string | null;
		requestedThreadId: string | null;
		preferRequestedThread: boolean;
		allowFallbackSelection?: boolean;
		fallbackFilter?: (thread: T) => boolean;
		retainedThreadIds?: readonly string[];
	},
) {
	const hasThread = (threadId: string | null) => {
		if (!threadId) {
			return false;
		}
		return (
			threads.some((thread) => thread.id === threadId) ||
			options.retainedThreadIds?.includes(threadId) === true
		);
	};

	if (options.preferRequestedThread && hasThread(options.requestedThreadId)) {
		return options.requestedThreadId;
	}
	if (hasThread(options.currentThreadId)) {
		return options.currentThreadId;
	}
	if (hasThread(options.requestedThreadId)) {
		return options.requestedThreadId;
	}
	if (options.allowFallbackSelection === false) {
		return null;
	}
	return (
		threads.find((thread) => options.fallbackFilter?.(thread) ?? true)?.id ??
		null
	);
}

export function shouldSelectActionResult(
	result: unknown,
	options: {
		selectResult?: boolean;
		actionSelectionSeq: number;
		currentSelectionSeq: number;
	},
): result is string {
	return (
		options.selectResult === true &&
		typeof result === "string" &&
		options.actionSelectionSeq === options.currentSelectionSeq
	);
}

export function shouldLoadThreadSelection(
	threadId: string,
	options: {
		currentThreadId: string | null;
		currentDetailThreadId: string | null;
	},
) {
	return (
		threadId !== options.currentThreadId ||
		threadId !== options.currentDetailThreadId
	);
}

const archivedSearchAliases = ["archive", "archived"] as const;

export function queryMatchesArchivedThreads(query: string) {
	return query
		.trim()
		.toLowerCase()
		.split(/\s+/)
		.some(
			(token) =>
				token.length >= 2 &&
				archivedSearchAliases.some((alias) => alias.startsWith(token)),
		);
}
