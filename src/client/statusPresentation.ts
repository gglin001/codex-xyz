import type { ThreadDisplayStatus, TurnStatus } from "../server/domain.js";

export type StatusPresentationTone =
	| "neutral"
	| "running"
	| "stale"
	| "error"
	| "completed";

export type StatusPresentationIcon =
	| "archive"
	| "check"
	| "error"
	| "idle"
	| "running"
	| "stop"
	| "unloaded";

export type StatusPresentation = {
	label: string;
	description: string;
	tone: StatusPresentationTone;
	icon: StatusPresentationIcon;
};

export type PresentedStatus = ThreadDisplayStatus | TurnStatus;

const statusPresentations: Record<PresentedStatus, StatusPresentation> = {
	active: {
		label: "Running",
		description: "A turn is currently running",
		tone: "running",
		icon: "running",
	},
	idle: {
		label: "Idle",
		description: "Loaded and ready for a new turn",
		tone: "neutral",
		icon: "idle",
	},
	not_loaded: {
		label: "Unloaded",
		description: "Not loaded in Codex app-server",
		tone: "neutral",
		icon: "unloaded",
	},
	system_error: {
		label: "Error",
		description: "Codex app-server could not load or run this thread",
		tone: "error",
		icon: "error",
	},
	archived: {
		label: "Archived",
		description: "Archived and hidden from active threads",
		tone: "neutral",
		icon: "archive",
	},
	in_progress: {
		label: "Running",
		description: "The turn is currently running",
		tone: "running",
		icon: "running",
	},
	completed: {
		label: "Completed",
		description: "The turn completed successfully",
		tone: "completed",
		icon: "check",
	},
	interrupted: {
		label: "Interrupted",
		description: "The turn stopped before completion",
		tone: "stale",
		icon: "stop",
	},
	failed: {
		label: "Failed",
		description: "The turn failed",
		tone: "error",
		icon: "error",
	},
};

export function statusPresentation(status: PresentedStatus) {
	return statusPresentations[status];
}

export function statusTooltip(status: PresentedStatus) {
	const presentation = statusPresentation(status);
	return `${presentation.label}: ${presentation.description}`;
}

export function threadStatusTooltip(
	status: ThreadDisplayStatus,
	lastTurnStatus: TurnStatus | null,
) {
	const current = statusTooltip(status);
	if (status !== "idle" || !lastTurnStatus) {
		return current;
	}
	const lastTurn = statusPresentation(lastTurnStatus);
	return `${current}. Last turn: ${lastTurn.label}`;
}
