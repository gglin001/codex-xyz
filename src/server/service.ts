import { statSync } from "node:fs";
import { resolve } from "node:path";
import {
	type CodexAdapter,
	isAdapterThreadNotFoundError,
} from "./codex/adapter.js";
import {
	type ControlThread,
	type CreateSessionInput,
	type DashboardState,
	type SetGoalInput,
	type SetGoalStatusInput,
	type StartTurnInput,
	type ThreadDetail,
	type ThreadPage,
	titleFromPrompt,
} from "./domain.js";
import { EventBus } from "./eventBus.js";
import {
	type RuntimeForkInput,
	type RuntimeThreadActionOptions,
	RuntimeThreadCoordinator,
} from "./runtimeThread.js";
import type { Store } from "./store.js";
import { TerminalController } from "./terminal.js";
import { ThreadProjection } from "./threadProjection.js";

function isNoActiveTurnError(error: unknown) {
	return error instanceof Error && /no active turn/i.test(error.message);
}

function isRuntimeStateMismatchError(error: unknown) {
	return (
		isAdapterThreadNotFoundError(error) ||
		isNoActiveTurnError(error) ||
		(error instanceof Error && /expected active turn id/i.test(error.message))
	);
}

function normalizeWorkingDirectory(path: string) {
	const resolved = resolve(path.trim());
	let stat: ReturnType<typeof statSync>;
	try {
		stat = statSync(resolved);
	} catch {
		throw new Error(`Working directory does not exist: ${resolved}`);
	}
	if (!stat.isDirectory()) {
		throw new Error(`Working directory is not a directory: ${resolved}`);
	}
	return resolved;
}

function parseShellCommandPrompt(prompt: string) {
	const trimmed = prompt.trimStart();
	if (!trimmed.startsWith("!")) {
		return null;
	}
	const command = trimmed.slice(1).trim();
	if (!command) {
		throw new Error("Shell command must not be empty");
	}
	return command;
}

const defaultThreadPageSize = 50;
const maxThreadPageSize = 200;

function normalizePageLimit(value?: number | null) {
	if (value === undefined || value === null) {
		return defaultThreadPageSize;
	}
	return Math.min(maxThreadPageSize, Math.max(1, Math.floor(value)));
}

function normalizePageOffset(value?: number | null) {
	if (value === undefined || value === null) {
		return 0;
	}
	return Math.max(0, Math.floor(value));
}

export class ControlService {
	private defaultCwd = process.cwd();
	private readonly runtimeThreads: RuntimeThreadCoordinator;
	private readonly projection: ThreadProjection;

	constructor(
		readonly store: Store,
		readonly adapter: CodexAdapter,
		readonly events = new EventBus(),
		readonly terminal = new TerminalController(),
	) {
		this.projection = new ThreadProjection(this.store, this.events);
		this.runtimeThreads = new RuntimeThreadCoordinator({
			resumeThread: (thread) => this.resumeRuntimeThread(thread),
			markThreadLost: (thread) => this.projection.markRuntimeThreadLost(thread),
			forkThread: (thread, input) => this.forkRuntimeThread(thread, input),
			notResumableError: (thread) =>
				new Error(
					`Thread ${thread.id} is not loaded by Codex and could not be resumed`,
				),
		});
		this.adapter.onEvent((event) => this.projection.applyAdapterEvent(event));
	}

	seedLocalState(input: {
		cwd: string;
		adapterName: string;
		cliVersion?: string | null;
	}) {
		const cwd = normalizeWorkingDirectory(input.cwd);
		this.defaultCwd = cwd;
		this.terminal.configure({ cwd });
		this.store.upsertHost({
			id: "local",
			name: "Local host",
			adapter: input.adapterName,
			version: input.cliVersion ?? null,
			defaultCwd: cwd,
		});
	}

	dashboard(): DashboardState {
		const latestEventId = this.store.getLatestEventId();
		const totalCount = this.store.countThreads();
		const limit = defaultThreadPageSize;
		const threads =
			totalCount <= defaultThreadPageSize
				? this.store.listThreads()
				: this.store.listThreads({ limit: defaultThreadPageSize, offset: 0 });
		return {
			threads,
			threadTotalCount: totalCount,
			threadPageSize: limit,
			threadNextOffset: threads.length,
			threadHasMore: threads.length < totalCount,
			defaultCwd: this.store.getDefaultCwd() ?? this.defaultCwd,
			latestEventId,
		};
	}

	async createSession(input: CreateSessionInput) {
		const cwd = normalizeWorkingDirectory(input.cwd);
		const title = input.title?.trim() || titleFromPrompt(input.prompt);
		const adapterThread = await this.adapter.startThread({
			cwd,
			promptPreview: titleFromPrompt(input.prompt),
			model: input.model ?? null,
		});
		const thread = this.projection.createThread({
			adapterThread,
			title,
			goalObjective: null,
			goalStatus: null,
			goalTokenBudget: null,
			preview: title,
			tokensUsed: 0,
		});
		this.projection.publish("thread.started", thread.id, null, { thread });

		if (input.goalMode) {
			const goalStart = await this.startGoal({
				threadId: thread.id,
				objective: input.prompt,
				tokenBudget: null,
			});
			return {
				thread: goalStart.thread,
				turn: goalStart.turn,
				goal: goalStart.goal,
			};
		}

		const turn = await this.startTurn({
			threadId: thread.id,
			prompt: input.prompt,
			model: input.model ?? null,
		});
		return {
			thread: this.store.getThread(turn.threadId),
			turn,
			goal: null,
		};
	}

	async startTurn(input: StartTurnInput) {
		const thread = this.requireThread(input.threadId);
		const shellCommand = parseShellCommandPrompt(input.prompt);
		if (shellCommand) {
			return this.startShellCommand(thread, input.prompt, shellCommand);
		}
		if (thread.activeTurnId) {
			try {
				await this.steerActiveTurn(thread, input.prompt);
			} catch (error) {
				if (!isNoActiveTurnError(error)) {
					throw error;
				}
				const current = this.projection.clearLostActiveTurn(thread);
				const { adapterTurn, thread: runtimeThread } =
					await this.startRuntimeTurn(current, input);
				return this.projection.recordTurn(
					runtimeThread,
					input.prompt,
					adapterTurn,
				);
			}
			const activeTurn = this.store.getTurn(thread.activeTurnId);
			if (!activeTurn) {
				throw new Error(`Active turn ${thread.activeTurnId} does not exist`);
			}
			return activeTurn;
		}
		const { adapterTurn, thread: runtimeThread } = await this.startRuntimeTurn(
			thread,
			input,
		);
		return this.projection.recordTurn(runtimeThread, input.prompt, adapterTurn);
	}

	async interruptTurn(threadId: string) {
		const thread = this.requireThread(threadId);
		if (!thread.activeTurnId) {
			return thread;
		}
		const activeTurnId = thread.activeTurnId;
		try {
			await this.adapter.interruptTurn({
				threadId: thread.id,
				turnId: activeTurnId,
			});
		} catch (error) {
			if (!isRuntimeStateMismatchError(error)) {
				throw error;
			}
			await this.syncThreadAfterRuntimeMismatch(thread);
			return this.store.getThread(threadId);
		}
		this.projection.publish(
			"turn.interrupt.requested",
			threadId,
			activeTurnId,
			{},
		);
		return this.store.getThread(threadId);
	}

	async resumeThread(threadId: string) {
		const thread = this.requireThread(threadId);
		const resumed = await this.resumeRuntimeThread(thread);
		if (!resumed) {
			this.projection.markRuntimeThreadLost(thread);
			throw new Error(
				`Thread ${thread.id} is not loaded by Codex and could not be resumed`,
			);
		}
		return this.store.getThread(threadId);
	}

	async forkThread(input: {
		threadId: string;
		cwd?: string | null;
		model?: string | null;
		title?: string | null;
	}) {
		const source = this.requireThread(input.threadId);
		const cwd = input.cwd ? normalizeWorkingDirectory(input.cwd) : source.cwd;
		const title = input.title?.trim() || `Fork of ${source.title}`;
		return this.createForkedThread(source, {
			cwd,
			model: input.model ?? source.model,
			title,
			preview: source.preview,
			eventReason: "manual",
			markSourceLost: false,
		});
	}

	async compactThread(threadId: string) {
		const source = this.requireThread(threadId);
		if (source.activeTurnId || source.status === "active") {
			throw new Error("Compact requires an idle thread");
		}
		const result = await this.runRuntimeAction(source, (runtimeThread) =>
			this.adapter.compactThread({ threadId: runtimeThread.id }),
		);
		return this.projection.recordTurn(result.thread, "/compact", result.value);
	}

	async archiveThread(threadId: string) {
		const source = this.requireThread(threadId);
		if (source.activeTurnId || source.status === "active") {
			throw new Error("Archive requires an idle thread");
		}
		if (source.status === "not_loaded") {
			return this.projection.archiveThread(threadId);
		}
		await this.withRuntimeThread(source, (runtimeThread) =>
			this.adapter.archiveThread(runtimeThread.id),
		);
		return this.projection.archiveThread(threadId);
	}

	async setGoal(input: SetGoalInput) {
		const source = this.requireThread(input.threadId);
		const goal = await this.withRuntimeThread(source, (runtimeThread) =>
			this.adapter.setGoal({
				threadId: runtimeThread.id,
				objective: input.objective,
				tokenBudget: input.tokenBudget,
			}),
		);
		this.projection.updateGoal(input.threadId, goal, null);
		return goal;
	}

	async setGoalStatus(input: SetGoalStatusInput) {
		const source = this.requireThread(input.threadId);
		const goal = await this.withRuntimeThread(source, (runtimeThread) =>
			this.adapter.setGoalStatus({
				threadId: runtimeThread.id,
				status: input.status,
			}),
		);
		const thread = this.projection.updateGoal(input.threadId, goal, null);
		return { goal, thread };
	}

	async startGoal(input: SetGoalInput) {
		const source = this.requireThread(input.threadId);
		if (source.activeTurnId || source.status !== "idle") {
			throw new Error("Goal mode requires an idle thread");
		}
		const { goal, turn: adapterTurn } = await this.withRuntimeThread(
			source,
			(runtimeThread) =>
				this.adapter.startGoal({
					threadId: runtimeThread.id,
					objective: input.objective,
					tokenBudget: input.tokenBudget,
				}),
		);
		const thread = this.projection.updateGoal(input.threadId, goal, null);
		if (!thread) {
			throw new Error(`Thread ${input.threadId} does not exist`);
		}
		const turn = this.projection.recordTurn(thread, "", adapterTurn);
		return {
			goal,
			turn,
			thread: this.store.getThread(turn.threadId),
		};
	}

	async getGoal(threadId: string) {
		const source = this.requireThread(threadId);
		return this.withRuntimeThread(source, (runtimeThread) =>
			this.adapter.getGoal(runtimeThread.id),
		);
	}

	async clearGoal(threadId: string) {
		const source = this.requireThread(threadId);
		await this.withRuntimeThread(source, (runtimeThread) =>
			this.adapter.clearGoal(runtimeThread.id),
		);
		return this.projection.updateGoal(threadId, null, null, {
			clearedStatus: "cleared",
		});
	}

	listThreads(input: { archived?: boolean | null } = {}) {
		return this.store.listThreads({ archived: input.archived });
	}

	listThreadPage(
		input: {
			limit?: number | null;
			offset?: number | null;
			archived?: boolean | null;
		} = {},
	): ThreadPage {
		const archived = input.archived ?? false;
		const totalCount = this.store.countThreads({ archived });
		const limit = normalizePageLimit(input.limit);
		const offset = normalizePageOffset(input.offset);
		const threads = this.store.listThreads({ limit, offset, archived });
		const nextOffset = offset + threads.length;
		return {
			threads,
			totalCount,
			offset,
			limit,
			nextOffset,
			hasMore: nextOffset < totalCount,
		};
	}

	getThreadDetail(threadId: string): ThreadDetail {
		const detail = this.store.getThreadDetail(threadId);
		if (!detail) {
			throw new Error(`Thread ${threadId} does not exist`);
		}
		return detail;
	}

	replayEvents(
		afterId = 0,
		options: { threadId?: string | null; summaryOnly?: boolean } = {},
	) {
		return this.store.listEvents(afterId, options);
	}

	async close() {
		await this.terminal.close();
		await this.adapter.close();
		this.store.close();
	}

	private async startShellCommand(
		thread: ControlThread,
		prompt: string,
		command: string,
	) {
		const { adapterTurn, thread: runtimeThread } =
			await this.startRuntimeShellCommand(thread, command);
		return this.projection.recordTurn(runtimeThread, prompt, adapterTurn);
	}

	private async steerActiveTurn(thread: ControlThread, prompt: string) {
		if (!thread.activeTurnId) {
			throw new Error("Thread has no active turn to steer");
		}
		const activeTurnId = await this.withRuntimeThread(
			thread,
			async (runtimeThread) => {
				if (!runtimeThread.activeTurnId) {
					throw new Error("Thread has no active turn to steer");
				}
				await this.adapter.steerTurn({
					threadId: runtimeThread.id,
					turnId: runtimeThread.activeTurnId,
					prompt,
				});
				return runtimeThread.activeTurnId;
			},
		);
		this.projection.publish("turn.steered", thread.id, activeTurnId, {
			prompt,
		});
	}

	private async startRuntimeTurn(thread: ControlThread, input: StartTurnInput) {
		const result = await this.runRuntimeAction(
			thread,
			(runtimeThread) =>
				this.adapter.startTurn({
					threadId: runtimeThread.id,
					prompt: input.prompt,
					model: input.model ?? runtimeThread.model,
				}),
			{
				fork: {
					prompt: input.prompt,
					model: input.model ?? thread.model,
				},
			},
		);
		return {
			thread: result.thread,
			adapterTurn: result.value,
		};
	}

	private async startRuntimeShellCommand(
		thread: ControlThread,
		command: string,
	) {
		const result = await this.runRuntimeAction(
			thread,
			(runtimeThread) =>
				this.adapter.runShellCommand({
					threadId: runtimeThread.id,
					command,
					activeTurnId:
						runtimeThread.id === thread.id ? runtimeThread.activeTurnId : null,
				}),
			{
				fork: {
					prompt: `!${command}`,
					model: thread.model,
				},
			},
		);
		return {
			thread: result.thread,
			adapterTurn: result.value,
		};
	}

	private async withRuntimeThread<T>(
		thread: ControlThread,
		action: (thread: ControlThread) => Promise<T>,
	) {
		return (await this.runtimeThreads.run(thread, action)).value;
	}

	private async runRuntimeAction<T>(
		thread: ControlThread,
		action: (thread: ControlThread) => Promise<T>,
		options: RuntimeThreadActionOptions = {},
	): Promise<{ thread: ControlThread; value: T }> {
		return this.runtimeThreads.run(thread, action, options);
	}

	private async resumeRuntimeThread(thread: ControlThread) {
		try {
			const adapterThread = await this.adapter.resumeThread({
				threadId: thread.id,
				cwd: thread.cwd,
				model: thread.model,
			});
			this.projection.applyRuntimeThreadSnapshot(thread, adapterThread);
			this.projection.publish("thread.resumed", thread.id, null, {
				thread: this.store.getThread(thread.id),
			});
			return this.store.getThread(thread.id) ?? thread;
		} catch (error) {
			if (isAdapterThreadNotFoundError(error)) {
				return null;
			}
			throw error;
		}
	}

	private async syncThreadAfterRuntimeMismatch(thread: ControlThread) {
		const resumed = await this.resumeRuntimeThread(thread);
		if (resumed) {
			return resumed;
		}
		this.projection.markRuntimeThreadLost(thread);
		return this.store.getThread(thread.id);
	}

	private async forkRuntimeThread(
		source: ControlThread,
		input: RuntimeForkInput,
	) {
		return this.createForkedThread(source, {
			cwd: source.cwd,
			model: input.model,
			title: source.title,
			preview: input.prompt,
			eventReason: "runtime_missing",
			markSourceLost: true,
		});
	}

	private async createForkedThread(
		source: ControlThread,
		input: {
			cwd: string;
			model: string | null;
			title: string;
			preview: string;
			eventReason: "manual" | "runtime_missing";
			markSourceLost: boolean;
		},
	) {
		if (input.markSourceLost) {
			this.projection.markRuntimeThreadLost(source);
		}
		const adapterThread = await this.adapter.forkThread({
			sourceThreadId: source.id,
			cwd: input.cwd,
			model: input.model,
		});
		const thread = this.projection.createThread({
			adapterThread,
			title: input.title,
			forkedFromId: source.id,
			goalObjective: source.goalObjective,
			goalStatus: source.goalStatus,
			goalTokenBudget: source.goalTokenBudget,
			preview: input.preview,
			tokensUsed: source.tokensUsed,
		});
		this.projection.publish("thread.forked", thread.id, null, {
			thread,
			sourceThreadId: source.id,
			reason: input.eventReason,
		});
		return thread;
	}

	private requireThread(threadId: string): ControlThread {
		const thread = this.store.getThread(threadId);
		if (!thread) {
			throw new Error(`Thread ${threadId} does not exist`);
		}
		return thread;
	}
}
