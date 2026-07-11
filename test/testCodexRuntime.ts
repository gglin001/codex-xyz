import { randomUUID } from "node:crypto";
import {
	type CodexRuntime,
	type CompactThreadInput,
	type ForkThreadInput,
	type ResumeThreadInput,
	type RunShellCommandInput,
	type RuntimeBackgroundTerminal,
	type RuntimeEvent,
	type RuntimeEventHandler,
	type RuntimeGoalSnapshot,
	type RuntimeGoalStart,
	RuntimeThreadNotFoundError,
	type RuntimeThreadSnapshot,
	type RuntimeTurnSnapshot,
	type StartRuntimeTurnInput,
	type StartThreadInput,
} from "../src/server/codex/runtimePort.js";
import type { ThreadRuntimeStatus } from "../src/server/domain.js";

type TestThread = RuntimeThreadSnapshot & {
	goal: RuntimeGoalSnapshot | null;
	activeTurnId: string | null;
};

type RunningTurn = {
	threadId: string;
	turnId: string;
	startedAt: number;
	completed: boolean;
};

export class TestCodexRuntime implements CodexRuntime {
	readonly name = "test";
	readonly version = "test";
	restartCount = 0;
	defaultModel: string | null = "test-codex";
	lastReadConfigInput: {
		cwd?: string | null;
		includeLayers?: boolean | null;
	} | null = null;
	lastStartTurnInput: StartRuntimeTurnInput | null = null;
	backgroundTerminals: RuntimeBackgroundTerminal[] = [];
	backgroundTerminalsCleanCount = 0;
	lastUserInputAnswer: {
		interactionId: string;
		answers: Record<string, string[]>;
	} | null = null;
	private handler: RuntimeEventHandler = () => {};
	private readonly threads = new Map<string, TestThread>();
	private readonly running = new Map<string, RunningTurn>();
	private closed = false;
	private nextThread = 1;

	onEvent(handler: RuntimeEventHandler) {
		this.handler = handler;
	}

	async readConfig(input = {}) {
		this.lastReadConfigInput = input;
		return {
			model: this.defaultModel,
			modelProvider: "test-provider",
			serviceTier: null,
		};
	}

	async startThread(input: StartThreadInput): Promise<RuntimeThreadSnapshot> {
		this.closed = false;
		const id = `runtime_thread_${this.nextThread++}`;
		const thread: TestThread = {
			id,
			sessionId: id,
			forkedFromId: null,
			name: input.name?.trim() || null,
			preview: input.preview,
			cwd: input.cwd,
			model: input.model ?? "test-codex",
			status: "idle",
			goal: null,
			activeTurnId: null,
		};
		this.threads.set(id, thread);
		return thread;
	}

	async resumeThread(input: ResumeThreadInput): Promise<RuntimeThreadSnapshot> {
		return this.requireThread(input.threadId);
	}

	async listThreads() {
		return { threads: [...this.threads.values()], nextCursor: null };
	}

	async searchThreads(input: { query: string }) {
		const query = input.query.toLowerCase();
		return {
			results: [...this.threads.values()]
				.filter((thread) =>
					`${thread.name ?? ""} ${thread.preview}`
						.toLowerCase()
						.includes(query),
				)
				.map((thread) => ({ thread, snippet: thread.preview })),
			nextCursor: null,
		};
	}

	async readThread(threadId: string) {
		return this.requireThread(threadId);
	}

	async readThreadHistory() {
		return { turns: [], nextCursor: null };
	}

	async startTurn(input: StartRuntimeTurnInput): Promise<RuntimeTurnSnapshot> {
		const thread = this.requireThread(input.threadId);
		this.lastStartTurnInput = input;
		const turnId = `turn_${randomUUID()}`;
		const running: RunningTurn = {
			threadId: input.threadId,
			turnId,
			startedAt: Date.now(),
			completed: false,
		};
		thread.activeTurnId = turnId;
		thread.status = "active";
		this.running.set(turnId, running);
		setTimeout(() => this.emitTurnOutput(input, turnId, running), 0);
		return { id: turnId, status: "in_progress" };
	}

	async runShellCommand(
		input: RunShellCommandInput,
	): Promise<RuntimeTurnSnapshot> {
		const thread = this.requireThread(input.threadId);
		const turnId = input.activeTurnId ?? `turn_${randomUUID()}`;
		const startedAt = Date.now();
		const running: RunningTurn = {
			threadId: input.threadId,
			turnId,
			startedAt,
			completed: false,
		};

		if (!input.activeTurnId) {
			thread.activeTurnId = turnId;
			thread.status = "active";
			this.running.set(turnId, running);
			this.emit({
				type: "turn.started",
				threadId: input.threadId,
				turnId,
				prompt: `!${input.command}`,
			});
		}

		setTimeout(() => this.emitShellCommandOutput(input, turnId, running), 0);
		return { id: turnId, status: "in_progress" };
	}

	async compactThread(input: CompactThreadInput): Promise<RuntimeTurnSnapshot> {
		const thread = this.requireThread(input.threadId);
		if (thread.activeTurnId) {
			throw new Error("thread already has an active turn");
		}
		const turnId = `turn_${randomUUID()}`;
		const running: RunningTurn = {
			threadId: input.threadId,
			turnId,
			startedAt: Date.now(),
			completed: false,
		};
		thread.activeTurnId = turnId;
		thread.status = "active";
		this.running.set(turnId, running);
		setTimeout(() => this.emitCompactOutput(input, turnId, running), 0);
		return { id: turnId, status: "in_progress" };
	}

	async steerTurn(input: { threadId: string; turnId: string; prompt: string }) {
		const thread = this.requireThread(input.threadId);
		if (
			thread.activeTurnId !== input.turnId ||
			!this.running.has(input.turnId)
		) {
			throw new Error("no active turn to steer");
		}
		this.emit({
			type: "item.created",
			threadId: input.threadId,
			turnId: input.turnId,
			itemId: `item_steer_${randomUUID()}`,
			itemType: "user",
			text: input.prompt,
			data: { steer: true },
		});
		this.emit({
			type: "item.created",
			threadId: input.threadId,
			turnId: input.turnId,
			itemId: `item_agent_${randomUUID()}`,
			itemType: "agent",
			text: `Steer received: ${input.prompt}`,
			data: { runtime: "test" },
		});
	}

	async interruptTurn(input: { threadId: string; turnId: string }) {
		this.requireThread(input.threadId);
		const running = this.running.get(input.turnId);
		if (running) {
			this.completeTurn(running, "interrupted");
		}
	}

	async forkThread(input: ForkThreadInput): Promise<RuntimeThreadSnapshot> {
		const source = this.requireThread(input.sourceThreadId);
		const id = `runtime_thread_${this.nextThread++}`;
		const thread: TestThread = {
			id,
			sessionId: source.sessionId,
			forkedFromId: source.id,
			name: input.name?.trim() || null,
			preview: `Fork of ${source.preview}`,
			cwd: input.cwd,
			model: input.model ?? source.model,
			status: "idle",
			goal: source.goal,
			activeTurnId: null,
		};
		this.threads.set(id, thread);
		return thread;
	}

	async archiveThread(threadId: string) {
		this.requireThread(threadId);
		this.threads.delete(threadId);
		this.emit({
			type: "thread.archived",
			threadId,
		});
	}

	async setThreadName(input: { threadId: string; name: string }) {
		const thread = this.requireThread(input.threadId);
		const name = input.name.trim();
		if (!name) {
			return;
		}
		thread.name = name;
		this.emit({
			type: "thread.name.updated",
			threadId: input.threadId,
			name,
		});
	}

	async setGoal(input: {
		threadId: string;
		objective: string;
		tokenBudget?: number | null;
	}) {
		const thread = this.requireThread(input.threadId);
		const goal: RuntimeGoalSnapshot = {
			objective: input.objective,
			status: "in_progress",
			tokenBudget: input.tokenBudget ?? null,
			tokensUsed: 0,
		};
		thread.goal = goal;
		return goal;
	}

	async setGoalStatus(input: {
		threadId: string;
		status: "active" | "paused" | "complete";
	}) {
		const thread = this.requireThread(input.threadId);
		if (!thread.goal) {
			throw new Error(`Test thread ${input.threadId} has no goal`);
		}
		const goal: RuntimeGoalSnapshot = {
			...thread.goal,
			status: input.status === "active" ? "in_progress" : input.status,
		};
		thread.goal = goal;
		return goal;
	}

	async startGoal(input: {
		threadId: string;
		objective: string;
		tokenBudget?: number | null;
	}): Promise<RuntimeGoalStart> {
		const thread = this.requireThread(input.threadId);
		const goal = await this.setGoal(input);
		const turnId = `turn_${randomUUID()}`;
		const running: RunningTurn = {
			threadId: input.threadId,
			turnId,
			startedAt: Date.now(),
			completed: false,
		};
		thread.activeTurnId = turnId;
		thread.status = "active";
		this.running.set(turnId, running);
		setTimeout(() => this.emitGoalTurnOutput(input, turnId, running), 0);
		return {
			goal,
			turn: {
				id: turnId,
				status: "in_progress",
			},
		};
	}

	async getGoal(threadId: string) {
		return this.requireThread(threadId).goal;
	}

	async clearGoal(threadId: string) {
		this.requireThread(threadId).goal = null;
	}

	async listBackgroundTerminals(): Promise<{
		terminals: RuntimeBackgroundTerminal[];
		nextCursor: string | null;
	}> {
		return {
			terminals: this.backgroundTerminals,
			nextCursor: null,
		};
	}

	async cleanBackgroundTerminals() {
		this.backgroundTerminalsCleanCount += 1;
		this.backgroundTerminals = [];
	}

	async answerUserInput(input: {
		interactionId: string;
		answers: Record<string, string[]>;
	}) {
		this.lastUserInputAnswer = input;
	}

	requestUserInput(input: {
		interactionId: string;
		threadId: string;
		turnId: string;
	}) {
		this.emit({
			type: "interaction.requested",
			...input,
			questions: [
				{
					id: "environment",
					header: "Environment",
					question: "Where should this run?",
					isOther: false,
					isSecret: false,
					options: [{ label: "Local", description: "Run locally" }],
				},
			],
			autoResolutionMs: 60_000,
		});
	}

	async restartAppServer() {
		this.restartCount += 1;
		return {
			status: "restarted" as const,
			pid: null,
			socketPath: "test://codex-app-server",
		};
	}

	completeActiveTurn(
		threadId: string,
		status: "completed" | "interrupted" | "failed" = "completed",
	) {
		const thread = this.requireThread(threadId);
		if (!thread.activeTurnId) {
			throw new Error(`Test thread ${threadId} has no active turn`);
		}
		const running = this.running.get(thread.activeTurnId);
		if (!running) {
			throw new Error(`Test turn ${thread.activeTurnId} is not running`);
		}
		this.completeTurn(running, status);
	}

	dropActiveTurn(
		threadId: string,
		status: Exclude<ThreadRuntimeStatus, "active"> = "idle",
	) {
		const thread = this.requireThread(threadId);
		if (thread.activeTurnId) {
			this.running.delete(thread.activeTurnId);
		}
		thread.activeTurnId = null;
		thread.status = status;
	}

	getThreadSnapshot(threadId: string) {
		return this.threads.get(threadId) ?? null;
	}

	async close() {
		this.closed = true;
		this.running.clear();
		this.threads.clear();
	}

	private emitTurnOutput(
		input: StartRuntimeTurnInput,
		turnId: string,
		running: RunningTurn,
	) {
		if (this.closed || running.completed) {
			return;
		}

		const answerId = `item_agent_${randomUUID()}`;
		this.emit({
			type: "item.created",
			threadId: input.threadId,
			turnId,
			itemId: `item_user_${randomUUID()}`,
			itemType: "user",
			text: input.prompt,
			data: { source: "test" },
		});
		this.emit({
			type: "thread.status",
			threadId: input.threadId,
			status: "active",
		});
		this.emit({
			type: "item.created",
			threadId: input.threadId,
			turnId,
			itemId: answerId,
			itemType: "agent",
			text: "",
			data: { runtime: "test" },
		});
		this.emit({
			type: "item.delta",
			threadId: input.threadId,
			turnId,
			itemId: answerId,
			delta: this.answer(input.prompt),
		});

		if (this.shouldStayRunning(input.prompt)) {
			return;
		}

		this.completeTurn(running, "completed");
	}

	private emitGoalTurnOutput(
		input: { threadId: string; objective: string },
		turnId: string,
		running: RunningTurn,
	) {
		if (this.closed || running.completed) {
			return;
		}

		const answerId = `item_agent_${randomUUID()}`;
		this.emit({
			type: "thread.status",
			threadId: input.threadId,
			status: "active",
		});
		this.emit({
			type: "item.created",
			threadId: input.threadId,
			turnId,
			itemId: answerId,
			itemType: "agent",
			text: "",
			data: { runtime: "test", goalTurn: true },
		});
		this.emit({
			type: "item.delta",
			threadId: input.threadId,
			turnId,
			itemId: answerId,
			delta: `Goal work started. Objective: ${input.objective}`,
		});
		this.completeTurn(running, "completed");
	}

	private emitShellCommandOutput(
		input: RunShellCommandInput,
		turnId: string,
		running: RunningTurn,
	) {
		if (this.closed || running.completed) {
			return;
		}

		const thread = this.requireThread(input.threadId);
		const output = this.shellOutput(input.command, thread);
		const itemId = `item_command_${randomUUID()}`;
		this.emit({
			type: "item.created",
			threadId: input.threadId,
			turnId,
			itemId,
			itemType: "command",
			text: `$ ${input.command}\n`,
			data: {
				command: input.command,
				source: "test-shell",
				status: "running",
			},
		});
		this.emit({
			type: "item.delta",
			threadId: input.threadId,
			turnId,
			itemId,
			delta: output,
		});
		this.emit({
			type: "item.created",
			threadId: input.threadId,
			turnId,
			itemId,
			itemType: "command",
			text: `$ ${input.command}\n${output}[completed, exit 0]`,
			data: {
				command: input.command,
				source: "test-shell",
				status: "completed",
				exitCode: 0,
			},
		});

		if (!input.activeTurnId) {
			this.completeTurn(running, "completed");
		}
	}

	private emitCompactOutput(
		input: CompactThreadInput,
		turnId: string,
		running: RunningTurn,
	) {
		if (this.closed || running.completed) {
			return;
		}

		this.emit({
			type: "thread.status",
			threadId: input.threadId,
			status: "active",
		});
		this.emit({
			type: "item.created",
			threadId: input.threadId,
			turnId,
			itemId: `item_compact_${randomUUID()}`,
			itemType: "system",
			text: "Compacted context",
			data: { sourceType: "contextCompaction" },
		});
		this.completeTurn(running, "completed");
	}

	private completeTurn(
		running: RunningTurn,
		status: "completed" | "interrupted" | "failed",
	) {
		if (running.completed) {
			return;
		}
		running.completed = true;
		this.running.delete(running.turnId);
		const thread = this.threads.get(running.threadId);
		if (thread?.activeTurnId === running.turnId) {
			thread.activeTurnId = null;
			thread.status = "idle";
		}
		this.emit({
			type: "turn.status",
			threadId: running.threadId,
			turnId: running.turnId,
			status,
			durationMs: Date.now() - running.startedAt,
		});
		this.emit({
			type: "thread.status",
			threadId: running.threadId,
			status: "idle",
		});
	}

	private shouldStayRunning(prompt: string) {
		return /keep this turn open|steering/i.test(prompt);
	}

	private answer(prompt: string) {
		const trimmed = prompt.trim().replace(/\s+/g, " ");
		return [
			"Test run started. ",
			"The control plane accepted the task and produced deterministic transcript output. ",
			`Prompt preview: ${trimmed.slice(0, 96)}`,
		].join("");
	}

	private shellOutput(command: string, thread: TestThread) {
		if (command.trim() === "pwd") {
			return `${thread.cwd}\n`;
		}
		return `Shell command executed: ${command}\n`;
	}

	private requireThread(id: string) {
		const thread = this.threads.get(id);
		if (!thread) {
			throw new RuntimeThreadNotFoundError(
				id,
				`Test thread ${id} does not exist`,
			);
		}
		return thread;
	}

	private emit(event: RuntimeEvent) {
		this.handler(event);
	}
}
