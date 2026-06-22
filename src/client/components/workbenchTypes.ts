import type {
	ControlThread,
	GoalStatus,
	SessionDisplayStatus,
	ThreadRuntimeStatus,
	TurnStatus,
} from "../../server/domain.js";

export type DateBucket = "Today" | "Yesterday" | "Older";
export type ComposerMode = "thread" | "new";

export type ProjectAccent = "emerald" | "violet" | "sky" | "slate";

export type WorkbenchSession = {
	id: string;
	threadId: string;
	sessionId: string;
	forkedFromId: string | null;
	title: string;
	preview: string;
	cwd: string;
	model: string | null;
	status: SessionDisplayStatus;
	runtimeStatus: ThreadRuntimeStatus;
	activeTurnId: string | null;
	lastTurnStatus: TurnStatus | null;
	goalObjective: string | null;
	goalStatus: GoalStatus | null;
	goalTokenBudget: number | null;
	tokensUsed: number;
	archivedAt: string | null;
	createdAt: string;
	updatedAt: string;
	dateBucket: DateBucket;
	thread: ControlThread;
};

export type WorkbenchProject = {
	id: string;
	name: string;
	path: string;
	initials: string;
	accent: ProjectAccent;
	sessions: WorkbenchSession[];
	totalSessions: number;
	runningSessions: number;
	tokenTotal: number;
};
