export type ThreadRuntimeStatus =
	| "idle"
	| "active"
	| "not_loaded"
	| "system_error";
export type TurnStatus = "in_progress" | "completed" | "interrupted" | "failed";
export type ThreadTagScore = 1 | 2 | 3;
export type ThreadDisplayStatus =
	| ThreadRuntimeStatus
	| "archived"
	| "turn_completed"
	| "turn_interrupted"
	| "turn_failed";

export type GoalStatus =
	| "in_progress"
	| "paused"
	| "blocked"
	| "usage_limited"
	| "budget_limited"
	| "complete"
	| "cleared";
export type GoalStatusUpdate = "active" | "paused" | "complete";

export type ItemType =
	| "user"
	| "agent"
	| "plan"
	| "command"
	| "file"
	| "system";

export type ControlThread = {
	id: string;
	sessionId: string;
	forkedFromId: string | null;
	name: string;
	preview: string;
	cwd: string;
	model: string | null;
	status: ThreadRuntimeStatus;
	activeTurnId: string | null;
	lastTurnStatus: TurnStatus | null;
	goalObjective: string | null;
	goalStatus: GoalStatus | null;
	goalTokenBudget: number | null;
	tokensUsed: number;
	tagScore: ThreadTagScore | null;
	archivedAt: string | null;
	createdAt: string;
	updatedAt: string;
};

export function isThreadRuntimeStatus(
	value: unknown,
): value is ThreadRuntimeStatus {
	return (
		value === "idle" ||
		value === "active" ||
		value === "not_loaded" ||
		value === "system_error"
	);
}

export function isTurnStatus(value: unknown): value is TurnStatus {
	return (
		value === "in_progress" ||
		value === "completed" ||
		value === "interrupted" ||
		value === "failed"
	);
}

export function threadRuntimeStatusFromTurnStatus(
	status: TurnStatus,
): ThreadRuntimeStatus {
	return status === "in_progress" ? "active" : "idle";
}

export function threadDisplayStatus(
	thread: Pick<ControlThread, "status" | "lastTurnStatus" | "archivedAt">,
): ThreadDisplayStatus {
	if (thread.archivedAt) {
		return "archived";
	}
	if (thread.status !== "idle") {
		return thread.status;
	}
	if (thread.lastTurnStatus === "completed") {
		return "turn_completed";
	}
	if (thread.lastTurnStatus === "interrupted") {
		return "turn_interrupted";
	}
	if (thread.lastTurnStatus === "failed") {
		return "turn_failed";
	}
	return "idle";
}

export type Turn = {
	id: string;
	threadId: string;
	status: TurnStatus;
	prompt: string;
	startedAt: string;
	completedAt: string | null;
	durationMs: number | null;
};

export type ThreadItem = {
	id: string;
	threadId: string;
	turnId: string | null;
	type: ItemType;
	text: string;
	data: Record<string, unknown>;
	createdAt: string;
};

export type ThreadItemPageCursor = {
	createdAt: string;
	id: string;
};

export type ThreadItemPageDirection = "after" | "before";

export type ThreadItemsPage = {
	threadId: string;
	items: ThreadItem[];
	limit: number;
	direction: ThreadItemPageDirection;
	cursor: ThreadItemPageCursor | null;
	nextCursor: ThreadItemPageCursor | null;
	hasMore: boolean;
	totalCount: number;
};

export type CozEvent = {
	id?: number;
	type: string;
	threadId: string | null;
	turnId: string | null;
	payload: Record<string, unknown>;
	createdAt: string;
};

export const summaryEventTypes = [
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

export function isSummaryEventType(type: string) {
	return summaryEventTypes.includes(type as (typeof summaryEventTypes)[number]);
}

export type ThreadDetail = ControlThread & {
	turns: Turn[];
	items: ThreadItem[];
	itemTotalCount: number;
	itemPageSize: number;
	itemPageDirection: ThreadItemPageDirection;
	itemNextCursor: ThreadItemPageCursor | null;
	itemHasMore: boolean;
	latestEventId: number;
};

export type ThreadPageCursor = {
	updatedAt: string;
	id: string;
};

export type ThreadPage = {
	threads: ControlThread[];
	totalCount: number;
	limit: number;
	cursor: ThreadPageCursor | null;
	nextCursor: ThreadPageCursor | null;
	hasMore: boolean;
};

export type DashboardState = {
	threads: ControlThread[];
	threadTotalCount: number;
	threadPageSize: number;
	threadNextCursor: ThreadPageCursor | null;
	threadHasMore: boolean;
	defaultCwd: string;
	defaultModel: string | null;
	latestEventId: number;
};

export type CodexAppServerRestartResponse = {
	status: "restarted";
	pid: number | null;
	socketPath: string;
	message: string;
};

export type TerminalProcessStatus =
	| "idle"
	| "starting"
	| "running"
	| "exited"
	| "failed";

export type TerminalStats = {
	ptyOutputChunks: number;
	ptyOutputBytes: number;
	outputFlushes: number;
	outputEventBytes: number;
	inputWrites: number;
	inputBytes: number;
	modelWrites: number;
	modelWriteBytes: number;
	modelWriteMs: number;
	modelPendingWrites: number;
	pendingOutputBytes: number;
	replayEvents: number;
	replayBytes: number;
	outputPaused: boolean;
	outputPauseCount: number;
	outputResumeCount: number;
};

export type TerminalSnapshot = {
	status: TerminalProcessStatus;
	command: string;
	cwd: string;
	pid: number | null;
	cols: number;
	rows: number;
	sequence: number;
	screen: string;
	title: string | null;
	startedAt: string | null;
	updatedAt: string;
	exitCode: number | null;
	signal: number | string | null;
	error: string | null;
	stats: TerminalStats;
};

export type TerminalOutputEvent = {
	sequence: number;
	type: "terminal.output";
	data: string;
	createdAt: string;
};

export type TerminalStatusEvent = {
	sequence: number;
	type: "terminal.status";
	snapshot: TerminalSnapshot;
	createdAt: string;
};

export type TerminalEvent = TerminalOutputEvent | TerminalStatusEvent;

export type BackgroundTerminal = {
	itemId: string;
	processId: string;
	command: string;
	cwd: string;
	osPid: number | null;
	cpuPercent: number | null;
	rssKb: number | null;
};

export type BackgroundTerminalPage = {
	terminals: BackgroundTerminal[];
	nextCursor: string | null;
};

export type CreateThreadInput = {
	cwd: string;
	prompt: string;
	goalMode?: boolean | null;
	name?: string | null;
	model?: string | null;
};

export type StartTurnInput = {
	threadId: string;
	prompt: string;
	model?: string | null;
};

export type SetGoalInput = {
	threadId: string;
	objective: string;
	tokenBudget?: number | null;
};

export type SetGoalStatusInput = {
	threadId: string;
	status: GoalStatusUpdate;
};

export function nowIso() {
	return new Date().toISOString();
}

export function threadNameFromPrompt(prompt: string) {
	const collapsed = prompt.trim().replace(/\s+/g, " ");
	if (collapsed.length <= 72) {
		return collapsed || "Untitled thread";
	}
	return `${collapsed.slice(0, 69)}...`;
}
