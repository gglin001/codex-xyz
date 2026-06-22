import type {
	GoalStatus,
	GoalStatusUpdate,
	ThreadRuntimeStatus,
	TurnStatus,
} from "../domain.js";

export type AdapterThread = {
	id: string;
	sessionId: string;
	forkedFromId: string | null;
	preview: string;
	cwd: string;
	model: string | null;
	status: ThreadRuntimeStatus;
	activeTurnId?: string | null;
	updatedAt?: string | null;
};

export type AdapterTurn = {
	id: string;
	status: TurnStatus;
};

export type AdapterGoal = {
	objective: string;
	status: GoalStatus;
	tokenBudget: number | null;
	tokensUsed: number;
};

export type AdapterGoalStart = {
	goal: AdapterGoal;
	turn: AdapterTurn;
};

export type AdapterTokenUsage = {
	totalTokens: number;
	inputTokens: number;
	cachedInputTokens: number;
	outputTokens: number;
	reasoningOutputTokens: number;
	modelContextWindow: number | null;
};

export type AdapterEvent =
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
			goal: AdapterGoal | null;
	  }
	| {
			type: "thread.renamed";
			threadId: string;
			title: string | null;
	  }
	| {
			type: "thread.token_usage";
			threadId: string;
			turnId: string | null;
			usage: AdapterTokenUsage;
	  }
	| {
			type: "raw";
			threadId?: string | null;
			turnId?: string | null;
			method: string;
			payload: Record<string, unknown>;
	  };

export type AdapterEventHandler = (event: AdapterEvent) => void;

export type StartThreadInput = {
	cwd: string;
	promptPreview: string;
	model?: string | null;
};

export type StartTurnAdapterInput = {
	threadId: string;
	prompt: string;
	model?: string | null;
};

export type RunShellCommandInput = {
	threadId: string;
	command: string;
	activeTurnId?: string | null;
};

export type ResumeThreadInput = {
	threadId: string;
	cwd: string;
	model?: string | null;
};

export type ForkThreadInput = {
	sourceThreadId: string;
	cwd: string;
	model?: string | null;
};

export class AdapterThreadNotFoundError extends Error {
	constructor(
		readonly threadId: string,
		message = `Thread not found: ${threadId}`,
	) {
		super(message);
		this.name = "AdapterThreadNotFoundError";
	}
}

export function isAdapterThreadNotFoundError(
	error: unknown,
): error is AdapterThreadNotFoundError {
	return error instanceof AdapterThreadNotFoundError;
}

export interface CodexAdapter {
	readonly name: string;
	readonly version: string | null;
	onEvent(handler: AdapterEventHandler): void;
	startThread(input: StartThreadInput): Promise<AdapterThread>;
	resumeThread(input: ResumeThreadInput): Promise<AdapterThread>;
	startTurn(input: StartTurnAdapterInput): Promise<AdapterTurn>;
	runShellCommand(input: RunShellCommandInput): Promise<AdapterTurn>;
	steerTurn(input: {
		threadId: string;
		turnId: string;
		prompt: string;
	}): Promise<void>;
	interruptTurn(input: { threadId: string; turnId: string }): Promise<void>;
	forkThread(input: ForkThreadInput): Promise<AdapterThread>;
	renameThread(input: { threadId: string; title: string }): Promise<void>;
	setGoal(input: {
		threadId: string;
		objective: string;
		tokenBudget?: number | null;
	}): Promise<AdapterGoal>;
	setGoalStatus(input: {
		threadId: string;
		status: GoalStatusUpdate;
	}): Promise<AdapterGoal>;
	startGoal(input: {
		threadId: string;
		objective: string;
		tokenBudget?: number | null;
	}): Promise<AdapterGoalStart>;
	getGoal(threadId: string): Promise<AdapterGoal | null>;
	clearGoal(threadId: string): Promise<void>;
	close(): Promise<void>;
}
