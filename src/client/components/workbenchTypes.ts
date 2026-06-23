import type {
	ControlThread,
	GoalStatus,
	ThreadDisplayStatus,
	ThreadRuntimeStatus,
	TurnStatus,
} from "../../server/domain.js";

export type DateBucket = "Today" | "Yesterday" | "Older";
export type ComposerMode = "thread" | "new";

export type ProjectAccent = "emerald" | "violet" | "sky" | "slate";

export type WorkbenchThread = {
	id: string;
	threadId: string;
	sessionId: string;
	forkedFromId: string | null;
	title: string;
	preview: string;
	cwd: string;
	model: string | null;
	status: ThreadDisplayStatus;
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
	threads: WorkbenchThread[];
	totalThreads: number;
	runningThreads: number;
	tokenTotal: number;
};
