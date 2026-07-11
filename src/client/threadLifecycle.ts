import type { ControlThread } from "../server/domain.js";

export function isThreadActive(thread: Pick<ControlThread, "lifecycleState">) {
	return (
		thread.lifecycleState === "active" ||
		thread.lifecycleState === "unarchive_pending" ||
		thread.lifecycleState === "unarchive_failed"
	);
}

export function isThreadArchived(
	thread: Pick<ControlThread, "lifecycleState">,
) {
	return (
		thread.lifecycleState === "archive_pending" ||
		thread.lifecycleState === "archive_failed" ||
		thread.lifecycleState === "archived"
	);
}

export function isThreadRuntimeActionable(
	thread: Pick<ControlThread, "lifecycleState">,
) {
	return thread.lifecycleState === "active";
}

export function canArchiveThread(
	thread: Pick<ControlThread, "lifecycleState">,
) {
	return (
		thread.lifecycleState === "active" ||
		thread.lifecycleState === "archive_failed"
	);
}

export function canUnarchiveThread(
	thread: Pick<ControlThread, "lifecycleState">,
) {
	return (
		thread.lifecycleState === "archived" ||
		thread.lifecycleState === "unarchive_failed"
	);
}

export function threadLifecycleLabel(
	thread: Pick<ControlThread, "lifecycleState">,
) {
	switch (thread.lifecycleState) {
		case "active":
			return "Active";
		case "archive_pending":
			return "Archiving";
		case "archived":
			return "Archived";
		case "unarchive_pending":
			return "Unarchiving";
		case "archive_failed":
			return "Archive failed";
		case "unarchive_failed":
			return "Unarchive failed";
		case "missing":
			return "Missing";
		case "deleted":
			return "Deleted";
	}
}
