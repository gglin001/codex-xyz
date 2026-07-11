import type {
	GoalStatus,
	GoalStatusUpdate,
	ItemType,
	ThreadRuntimeStatus,
	ThreadSourceKind,
	TurnStatus,
} from "../domain.js";

export type RuntimeThreadSnapshot = {
	id: string;
	sessionId: string;
	forkedFromId: string | null;
	parentThreadId: string | null;
	sourceKind: ThreadSourceKind;
	agentNickname: string | null;
	agentRole: string | null;
	name: string | null;
	preview: string;
	cwd: string;
	model: string | null;
	status: ThreadRuntimeStatus;
	activeTurnId?: string | null;
	updatedAt?: string | null;
};

export type RuntimeTurnSnapshot = {
	id: string;
	status: TurnStatus;
};

export type RuntimeGoalSnapshot = {
	objective: string;
	status: GoalStatus;
	tokenBudget: number | null;
	tokensUsed: number;
};

export type RuntimeGoalStart = {
	goal: RuntimeGoalSnapshot;
	turn: RuntimeTurnSnapshot;
};

export type RuntimeTokenUsage = {
	totalTokens: number;
	inputTokens: number;
	cachedInputTokens: number;
	outputTokens: number;
	reasoningOutputTokens: number;
	modelContextWindow: number | null;
};

export type RuntimeConfigSnapshot = {
	model: string | null;
	modelProvider: string | null;
	serviceTier: string | null;
};

export type ReadRuntimeConfigInput = {
	cwd?: string | null;
	includeLayers?: boolean | null;
};

export type RuntimeEvent =
	| {
			type: "item.created";
			threadId: string;
			turnId: string | null;
			itemId: string;
			itemType: "user" | "agent" | "plan" | "command" | "file" | "system";
			text: string;
			data?: Record<string, unknown>;
	  }
	| {
			type: "item.delta";
			threadId: string;
			turnId: string;
			itemId: string;
			delta: string;
			itemType?: "user" | "agent" | "plan" | "command" | "file" | "system";
	  }
	| {
			type: "item.updated";
			threadId: string;
			turnId: string | null;
			itemId: string;
			itemType: "user" | "agent" | "plan" | "command" | "file" | "system";
			text: string;
			data?: Record<string, unknown>;
	  }
	| {
			type: "turn.status";
			threadId: string;
			turnId: string;
			status: TurnStatus;
			durationMs?: number | null;
	  }
	| {
			type: "turn.started";
			threadId: string;
			turnId: string;
			prompt?: string | null;
	  }
	| {
			type: "thread.status";
			threadId: string;
			status: ThreadRuntimeStatus;
	  }
	| {
			type: "thread.goal";
			threadId: string;
			turnId: string | null;
			goal: RuntimeGoalSnapshot | null;
	  }
	| {
			type: "thread.name.updated";
			threadId: string;
			name: string | null;
	  }
	| {
			type: "thread.token_usage";
			threadId: string;
			turnId: string | null;
			usage: RuntimeTokenUsage;
	  }
	| {
			type: "thread.archived";
			threadId: string;
	  }
	| {
			type: "thread.unarchived";
			threadId: string;
	  }
	| {
			type: "thread.deleted";
			threadId: string;
	  }
	| {
			type: "raw";
			threadId?: string | null;
			turnId?: string | null;
			method: string;
			payload: Record<string, unknown>;
	  };

export type RuntimeEventHandler = (event: RuntimeEvent) => void;

export type CodexAppServerRestartResult = {
	status: "restarted";
	pid: number | null;
	socketPath: string;
};

export type StartThreadInput = {
	cwd: string;
	name?: string | null;
	preview: string;
	model?: string | null;
};

export type StartRuntimeTurnInput = {
	threadId: string;
	prompt: string;
	model?: string | null;
};

export type RunShellCommandInput = {
	threadId: string;
	command: string;
	activeTurnId?: string | null;
};

export type CompactThreadInput = {
	threadId: string;
};

export type ResumeThreadInput = {
	threadId: string;
	cwd: string;
	model?: string | null;
};

export type RuntimeThreadListInput = {
	cursor?: string | null;
	limit?: number | null;
	archived?: boolean | null;
	cwd?: string | string[] | null;
};

export type RuntimeThreadPage = {
	threads: RuntimeThreadSnapshot[];
	nextCursor: string | null;
};

export type RuntimeThreadSearchInput = {
	query: string;
	cursor?: string | null;
	limit?: number | null;
	archived?: boolean | null;
};

export type RuntimeThreadSearchResult = {
	thread: RuntimeThreadSnapshot;
	snippet: string;
};

export type RuntimeThreadSearchPage = {
	results: RuntimeThreadSearchResult[];
	nextCursor: string | null;
};

export type RuntimeHistoryItemSnapshot = {
	id: string;
	type: ItemType;
	text: string;
	data: Record<string, unknown>;
	createdAt: string;
};

export type RuntimeHistoryTurnSnapshot = {
	id: string;
	status: TurnStatus;
	prompt: string;
	startedAt: string;
	completedAt: string | null;
	durationMs: number | null;
	items: RuntimeHistoryItemSnapshot[];
};

export type RuntimeThreadHistorySnapshot = {
	turns: RuntimeHistoryTurnSnapshot[];
	nextCursor: string | null;
};

export type ForkThreadInput = {
	sourceThreadId: string;
	cwd: string;
	name?: string | null;
	model?: string | null;
};

export type RuntimeBackgroundTerminal = {
	itemId: string;
	processId: string;
	command: string;
	cwd: string;
	osPid: number | null;
	cpuPercent: number | null;
	rssKb: number | null;
};

export class RuntimeThreadNotFoundError extends Error {
	constructor(
		readonly threadId: string,
		message = `Thread not found: ${threadId}`,
	) {
		super(message);
		this.name = "RuntimeThreadNotFoundError";
	}
}

export function isRuntimeThreadNotFoundError(
	error: unknown,
): error is RuntimeThreadNotFoundError {
	return error instanceof RuntimeThreadNotFoundError;
}

export interface CodexRuntime {
	readonly name: string;
	readonly version: string | null;
	onEvent(handler: RuntimeEventHandler): void;
	readConfig(input?: ReadRuntimeConfigInput): Promise<RuntimeConfigSnapshot>;
	startThread(input: StartThreadInput): Promise<RuntimeThreadSnapshot>;
	listThreads(input?: RuntimeThreadListInput): Promise<RuntimeThreadPage>;
	searchThreads(
		input: RuntimeThreadSearchInput,
	): Promise<RuntimeThreadSearchPage>;
	readThread(threadId: string): Promise<RuntimeThreadSnapshot>;
	readThreadHistory(threadId: string): Promise<RuntimeThreadHistorySnapshot>;
	resumeThread(input: ResumeThreadInput): Promise<RuntimeThreadSnapshot>;
	startTurn(input: StartRuntimeTurnInput): Promise<RuntimeTurnSnapshot>;
	runShellCommand(input: RunShellCommandInput): Promise<RuntimeTurnSnapshot>;
	compactThread(input: CompactThreadInput): Promise<RuntimeTurnSnapshot>;
	steerTurn(input: {
		threadId: string;
		turnId: string;
		prompt: string;
	}): Promise<void>;
	interruptTurn(input: { threadId: string; turnId: string }): Promise<void>;
	forkThread(input: ForkThreadInput): Promise<RuntimeThreadSnapshot>;
	archiveThread(threadId: string): Promise<void>;
	unarchiveThread(threadId: string): Promise<void>;
	setThreadName(input: { threadId: string; name: string }): Promise<void>;
	setGoal(input: {
		threadId: string;
		objective: string;
		tokenBudget?: number | null;
	}): Promise<RuntimeGoalSnapshot>;
	setGoalStatus(input: {
		threadId: string;
		status: GoalStatusUpdate;
	}): Promise<RuntimeGoalSnapshot>;
	startGoal(input: {
		threadId: string;
		objective: string;
		tokenBudget?: number | null;
	}): Promise<RuntimeGoalStart>;
	getGoal(threadId: string): Promise<RuntimeGoalSnapshot | null>;
	clearGoal(threadId: string): Promise<void>;
	listBackgroundTerminals(input: {
		threadId: string;
		limit?: number | null;
		cursor?: string | null;
	}): Promise<{
		terminals: RuntimeBackgroundTerminal[];
		nextCursor: string | null;
	}>;
	cleanBackgroundTerminals(threadId: string): Promise<void>;
	restartAppServer(): Promise<CodexAppServerRestartResult>;
	close(): Promise<void>;
}
