import {
	type ControlThread,
	isSubagentDirectInputRestricted,
} from "../server/domain.js";
import {
	canArchiveThread,
	canUnarchiveThread,
	isThreadRuntimeActionable,
} from "./threadLifecycle.js";

type ComposerThreadActionInput = {
	thread: ControlThread | null;
	threadId: string | null;
	pendingSubmission: boolean;
	busy: boolean;
};

export type ComposerThreadActionState = {
	goal: string | null;
	compact: string | null;
	interrupt: string | null;
	fork: string | null;
	backgroundTerminals: string | null;
	resume: string | null;
	archive: string | null;
	unarchive: string | null;
	goalStatus: string | null;
	clearGoal: string | null;
};

function actionableThreadReason(input: ComposerThreadActionInput) {
	if (!input.threadId || !input.thread) {
		return "Select a thread first";
	}
	if (!isThreadRuntimeActionable(input.thread)) {
		return "This thread lifecycle state is view-only";
	}
	if (input.pendingSubmission) {
		return "Wait for the submission to finish";
	}
	if (input.busy) {
		return "Another action is running";
	}
	return null;
}

export function getComposerThreadActionState(
	input: ComposerThreadActionInput,
): ComposerThreadActionState {
	const baseReason = actionableThreadReason(input);
	const thread = input.thread;
	const activeTurn =
		thread?.status === "active" || Boolean(thread?.activeTurnId);
	const idleReason =
		baseReason ?? (activeTurn ? "Wait for the active turn to finish" : null);
	const goalReason = idleReason;
	const directInputReason =
		baseReason ??
		(thread && isSubagentDirectInputRestricted(thread)
			? "Control this sub-agent from its parent thread"
			: null);
	const interruptReason =
		baseReason ?? (activeTurn ? null : "No active turn is running");
	const resumeReason =
		baseReason ??
		(thread?.status === "not_loaded" || thread?.status === "system_error"
			? null
			: thread?.status === "active"
				? "Thread is already running"
				: "Thread is already loaded");

	let archiveReason: string | null = null;
	if (!input.threadId || !thread) {
		archiveReason = "Select a thread first";
	} else if (!canArchiveThread(thread)) {
		archiveReason = thread.lifecycleState.endsWith("_pending")
			? "Wait for the lifecycle operation to finish"
			: "This thread cannot be archived";
	} else if (input.busy) {
		archiveReason = "Another action is running";
	} else if (activeTurn) {
		archiveReason = "Wait for the active turn to finish";
	}

	let unarchiveReason: string | null = null;
	if (!input.threadId || !thread) {
		unarchiveReason = "Select an archived thread first";
	} else if (!canUnarchiveThread(thread)) {
		unarchiveReason = thread.lifecycleState.endsWith("_pending")
			? "Wait for the lifecycle operation to finish"
			: "This thread cannot be unarchived";
	} else if (input.busy) {
		unarchiveReason = "Another action is running";
	}

	const goalStatusReason =
		baseReason ??
		(thread?.goalObjective && thread.goalStatus !== "cleared"
			? null
			: "This thread has no goal");

	return {
		goal: directInputReason ?? goalReason,
		compact: idleReason,
		interrupt: interruptReason,
		fork: baseReason,
		backgroundTerminals: baseReason,
		resume: resumeReason,
		archive: archiveReason,
		unarchive: unarchiveReason,
		goalStatus: goalStatusReason,
		clearGoal: goalStatusReason,
	};
}

export function showsUnarchiveAction(
	thread: Pick<ControlThread, "lifecycleState"> | null,
) {
	return (
		thread?.lifecycleState === "archived" ||
		thread?.lifecycleState === "unarchive_pending" ||
		thread?.lifecycleState === "unarchive_failed"
	);
}
