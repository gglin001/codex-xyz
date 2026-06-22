import type { ControlThread } from "../server/domain.js";

export function choosePreferredThreadId(
	threads: Pick<ControlThread, "id">[],
	options: {
		currentThreadId: string | null;
		requestedThreadId: string | null;
		preferRequestedThread: boolean;
		allowFallbackSelection?: boolean;
	},
) {
	const hasThread = (threadId: string | null) =>
		Boolean(threadId && threads.some((thread) => thread.id === threadId));

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
	return threads[0]?.id ?? null;
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
