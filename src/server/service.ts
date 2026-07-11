import { statSync } from "node:fs";
import { resolve } from "node:path";
import {
	type CodexRuntime,
	isRuntimeThreadNotFoundError,
} from "./codex/runtimePort.js";
import {
	type ControlThread,
	type CreateThreadInput,
	type DashboardState,
	type SetGoalInput,
	type SetGoalStatusInput,
	type StartTurnInput,
	type ThreadDetail,
	type ThreadItemPageCursor,
	type ThreadItemPageDirection,
	type ThreadItemsPage,
	type ThreadOperation,
	type ThreadOperationKind,
	type ThreadPage,
	type ThreadPageCursor,
	type ThreadTagScore,
	threadNameFromPrompt,
} from "./domain.js";
import { EventBus } from "./eventBus.js";
import {
	type RuntimeForkInput,
	type RuntimeThreadActionOptions,
	RuntimeThreadCoordinator,
} from "./runtimeThread.js";
import type { Store } from "./store.js";
import { TerminalController } from "./terminal.js";
import {
	reconcileRuntimeThreadHistory,
	reconcileRuntimeThreadSnapshot,
	reconcileRuntimeThreads,
} from "./threadHistoryReconciliation.js";
import { ThreadProjection } from "./threadProjection.js";

function isNoActiveTurnError(error: unknown) {
	return error instanceof Error && /no active turn/i.test(error.message);
}

function isRuntimeStateMismatchError(error: unknown) {
	return (
		isRuntimeThreadNotFoundError(error) ||
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

function normalizeThreadTagScore(value: ThreadTagScore | null) {
	if (value === null || value === 1 || value === 2 || value === 3) {
		return value;
	}
	throw new Error("Thread tag score must be 1, 2, 3, or null");
}

function pageCursorFromThreads(
	threads: ControlThread[],
): ThreadPageCursor | null {
	const thread = threads.at(-1);
	return thread ? { updatedAt: thread.updatedAt, id: thread.id } : null;
}

export class ControlService {
	private readonly hydratedHistoryThreads = new Set<string>();
	private defaultCwd = process.cwd();
	private defaultModel: string | null = null;
	private readonly runtimeThreads: RuntimeThreadCoordinator;
	private readonly projection: ThreadProjection;
	private syncPromise: Promise<
		ReturnType<typeof reconcileRuntimeThreadSnapshot>
	> | null = null;
	private startPromise: Promise<void> | null = null;
	private syncTimer: ReturnType<typeof setInterval> | null = null;
	private runtimeEpoch = 0;

	constructor(
		readonly store: Store,
		readonly runtime: CodexRuntime,
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
		this.runtime.onEvent((event) => this.projection.applyRuntimeEvent(event));
	}

	seedLocalState(input: {
		cwd: string;
		runtimeName: string;
		cliVersion?: string | null;
	}) {
		const cwd = normalizeWorkingDirectory(input.cwd);
		this.defaultCwd = cwd;
		this.terminal.configure({ cwd });
		this.store.upsertHost({
			id: "local",
			name: "Local host",
			runtime: input.runtimeName,
			version: input.cliVersion ?? null,
			defaultCwd: cwd,
		});
	}

	async dashboard(): Promise<DashboardState> {
		const latestEventId = this.store.getLatestEventId();
		const totalCount = this.store.countThreads();
		const limit = defaultThreadPageSize;
		const defaultCwd = this.store.getDefaultCwd() ?? this.defaultCwd;
		const pageThreads =
			totalCount <= defaultThreadPageSize
				? this.store.listThreads()
				: this.store.listThreads({ limit: defaultThreadPageSize + 1 });
		const threadHasMore = pageThreads.length > limit;
		const threads = threadHasMore ? pageThreads.slice(0, limit) : pageThreads;
		return {
			threads,
			threadTotalCount: totalCount,
			threadPageSize: limit,
			threadNextCursor: threadHasMore ? pageCursorFromThreads(threads) : null,
			threadHasMore,
			defaultCwd,
			defaultModel: this.defaultModel,
			latestEventId,
		};
	}

	start() {
		if (this.startPromise) return this.startPromise;
		this.startPromise = (async () => {
			this.runtimeEpoch = this.store.beginRuntimeEpoch();
			this.syncTimer = setInterval(() => {
				void this.syncThreads().catch(() => {});
			}, 60_000);
			this.syncTimer.unref?.();
			await this.syncThreads().catch(() => {});
			await this.recoverThreadOperations();
			this.defaultModel = await this.readDefaultModel(this.defaultCwd);
		})();
		return this.startPromise;
	}

	ready() {
		return this.start();
	}

	async syncThreadHistory(
		input: {
			limit?: number | null;
			cursor?: string | null;
			archived?: boolean | null;
		} = {},
	) {
		await this.syncThreads();
		return {
			threads: this.store.listThreads({ archived: input.archived }),
			nextCursor: null,
		};
	}

	private async collectRuntimeThreads(archived: boolean) {
		const threads = [];
		let cursor: string | null = null;
		const visitedCursors = new Set<string>();
		do {
			const page = await this.runtime.listThreads({
				archived,
				cursor,
				limit: maxThreadPageSize,
			});
			threads.push(...page.threads);
			cursor = page.nextCursor;
			if (cursor && visitedCursors.has(cursor)) {
				throw new Error(`Codex returned a repeated thread cursor: ${cursor}`);
			}
			if (cursor) {
				visitedCursors.add(cursor);
			}
		} while (cursor);
		return threads;
	}

	syncThreads() {
		if (this.syncPromise) return this.syncPromise;
		const context = this.store.beginRemoteSync();
		this.syncPromise = Promise.all([
			this.collectRuntimeThreads(false),
			this.collectRuntimeThreads(true),
		])
			.then(([active, archived]) => {
				const result = reconcileRuntimeThreadSnapshot(this.store, {
					active,
					archived,
					...context,
					runtimeEpoch: this.runtimeEpoch,
				});
				if (result.changed) {
					this.projection.publish("threads.synced", null, null, {
						generation: context.generation,
					});
				}
				return result;
			})
			.finally(() => {
				this.syncPromise = null;
			});
		return this.syncPromise;
	}

	async searchThreadHistory(input: {
		query: string;
		limit?: number | null;
		cursor?: string | null;
		archived?: boolean | null;
	}) {
		const page = await this.runtime.searchThreads(input);
		const threads = reconcileRuntimeThreads(
			this.store,
			page.results.map((result) => result.thread),
			{ archived: input.archived },
		);
		const byId = new Map(threads.map((thread) => [thread.id, thread]));
		return {
			results: page.results.map((result) => ({
				thread: byId.get(result.thread.id) ?? result.thread,
				snippet: result.snippet,
			})),
			nextCursor: page.nextCursor,
		};
	}

	async discoverThread(threadId: string) {
		const runtimeThread = await this.runtime.readThread(threadId);
		return reconcileRuntimeThreads(this.store, [runtimeThread])[0];
	}

	async getHydratedThreadDetail(threadId: string): Promise<ThreadDetail> {
		let thread = this.store.getThread(threadId);
		if (!thread) {
			thread = (await this.discoverThread(threadId)) ?? null;
		}
		if (!thread) {
			throw new Error(`Thread ${threadId} does not exist`);
		}
		if (!this.hydratedHistoryThreads.has(threadId)) {
			try {
				const history = await this.runtime.readThreadHistory(threadId);
				reconcileRuntimeThreadHistory(this.store, threadId, history);
				this.hydratedHistoryThreads.add(threadId);
			} catch (error) {
				if (this.store.listTurns(threadId).length === 0) throw error;
			}
		}
		return this.getThreadDetail(threadId);
	}

	private async readDefaultModel(cwd: string) {
		try {
			const config = await this.runtime.readConfig({ cwd });
			return config.model;
		} catch {
			return null;
		}
	}

	async createThread(input: CreateThreadInput) {
		const cwd = normalizeWorkingDirectory(input.cwd);
		const name = input.name?.trim() || threadNameFromPrompt(input.prompt);
		const runtimeThread = await this.runtime.startThread({
			cwd,
			name,
			preview: threadNameFromPrompt(input.prompt),
			model: input.model ?? null,
		});
		const thread = this.projection.createThread(
			{
				runtimeThread,
				name,
				goalObjective: null,
				goalStatus: null,
				goalTokenBudget: null,
				preview: name,
				tokensUsed: 0,
			},
			{
				type: "thread.started",
			},
		);

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
				const { runtimeTurn, thread: runtimeThread } =
					await this.startRuntimeTurn(current, input);
				return this.projection.recordTurn(
					runtimeThread,
					input.prompt,
					runtimeTurn,
				);
			}
			const activeTurn = this.store.getTurn(thread.activeTurnId);
			if (!activeTurn) {
				throw new Error(`Active turn ${thread.activeTurnId} does not exist`);
			}
			return activeTurn;
		}
		const { runtimeTurn, thread: runtimeThread } = await this.startRuntimeTurn(
			thread,
			input,
		);
		return this.projection.recordTurn(runtimeThread, input.prompt, runtimeTurn);
	}

	async interruptTurn(threadId: string) {
		const thread = this.requireThread(threadId);
		if (!thread.activeTurnId) {
			return thread;
		}
		const activeTurnId = thread.activeTurnId;
		try {
			await this.runtime.interruptTurn({
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
		name?: string | null;
	}) {
		const source = this.requireThread(input.threadId);
		const cwd = input.cwd ? normalizeWorkingDirectory(input.cwd) : source.cwd;
		const name = input.name?.trim() || `Fork of ${source.name}`;
		return this.createForkedThread(source, {
			cwd,
			model: input.model ?? source.model,
			name,
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
			this.runtime.compactThread({ threadId: runtimeThread.id }),
		);
		return this.projection.recordTurn(result.thread, "/compact", result.value);
	}

	async archiveThread(threadId: string) {
		const source = this.requireThread(threadId);
		if (source.activeTurnId || source.status === "active") {
			throw new Error("Archive requires an idle thread");
		}
		return this.beginLifecycleOperation(threadId, "archive");
	}

	async unarchiveThread(threadId: string) {
		this.requireThread(threadId);
		return this.beginLifecycleOperation(threadId, "unarchive");
	}

	setThreadTagScore(input: {
		threadId: string;
		tagScore: ThreadTagScore | null;
	}) {
		this.requireThread(input.threadId);
		return this.projection.updateThreadTagScore(
			input.threadId,
			normalizeThreadTagScore(input.tagScore),
		);
	}

	async setGoal(input: SetGoalInput) {
		const source = this.requireThread(input.threadId);
		const goal = await this.withRuntimeThread(source, (runtimeThread) =>
			this.runtime.setGoal({
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
			this.runtime.setGoalStatus({
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
		const { goal, turn: runtimeTurn } = await this.withRuntimeThread(
			source,
			(runtimeThread) =>
				this.runtime.startGoal({
					threadId: runtimeThread.id,
					objective: input.objective,
					tokenBudget: input.tokenBudget,
				}),
		);
		const thread = this.projection.updateGoal(input.threadId, goal, null);
		if (!thread) {
			throw new Error(`Thread ${input.threadId} does not exist`);
		}
		const turn = this.projection.recordTurn(thread, "", runtimeTurn);
		return {
			goal,
			turn,
			thread: this.store.getThread(turn.threadId),
		};
	}

	async getGoal(threadId: string) {
		const source = this.requireThread(threadId);
		return this.withRuntimeThread(source, (runtimeThread) =>
			this.runtime.getGoal(runtimeThread.id),
		);
	}

	async clearGoal(threadId: string) {
		const source = this.requireThread(threadId);
		await this.withRuntimeThread(source, (runtimeThread) =>
			this.runtime.clearGoal(runtimeThread.id),
		);
		return this.projection.updateGoal(threadId, null, null, {
			clearedStatus: "cleared",
		});
	}

	async listBackgroundTerminals(threadId: string) {
		const source = this.requireThread(threadId);
		return this.withRuntimeThread(source, (runtimeThread) =>
			this.runtime.listBackgroundTerminals({
				threadId: runtimeThread.id,
				limit: 50,
			}),
		);
	}

	async cleanBackgroundTerminals(threadId: string) {
		const source = this.requireThread(threadId);
		await this.withRuntimeThread(source, (runtimeThread) =>
			this.runtime.cleanBackgroundTerminals(runtimeThread.id),
		);
		return this.store.getThread(threadId);
	}

	async restartCodexAppServer() {
		const result = await this.runtime.restartAppServer();
		this.runtimeEpoch = this.store.beginRuntimeEpoch();
		await this.recoverThreadOperations();
		await this.syncThreads();
		this.defaultModel = await this.readDefaultModel(this.defaultCwd);
		return {
			...result,
			message: "Codex app-server restarted",
		};
	}

	listThreads(input: { archived?: boolean | null } = {}) {
		return this.store.listThreads({ archived: input.archived });
	}

	listThreadPage(
		input: {
			limit?: number | null;
			cursor?: ThreadPageCursor | null;
			archived?: boolean | null;
		} = {},
	): ThreadPage {
		const archived = input.archived ?? false;
		const totalCount = this.store.countThreads({ archived });
		const limit = normalizePageLimit(input.limit);
		const cursor = input.cursor ?? null;
		const pageThreads = this.store.listThreads({
			limit: limit + 1,
			cursor,
			archived,
		});
		const hasMore = pageThreads.length > limit;
		const threads = hasMore ? pageThreads.slice(0, limit) : pageThreads;
		return {
			threads,
			totalCount,
			limit,
			cursor,
			nextCursor: hasMore ? pageCursorFromThreads(threads) : null,
			hasMore,
		};
	}

	getThreadDetail(threadId: string): ThreadDetail {
		const detail = this.store.getThreadDetail(threadId);
		if (!detail) {
			throw new Error(`Thread ${threadId} does not exist`);
		}
		return detail;
	}

	listThreadItemsPage(
		threadId: string,
		input: {
			limit?: number | null;
			direction?: ThreadItemPageDirection;
			cursor?: ThreadItemPageCursor | null;
		} = {},
	): ThreadItemsPage {
		this.requireThread(threadId);
		return this.store.listThreadItemsPage(threadId, input);
	}

	replayEvents(
		afterId = 0,
		options: {
			threadId?: string | null;
			summaryOnly?: boolean;
			limit?: number | null;
			maxPayloadBytes?: number | null;
		} = {},
	) {
		return this.store.listEvents(afterId, options);
	}

	getLatestReplayEventId(
		options: { threadId?: string | null; summaryOnly?: boolean } = {},
	) {
		return this.store.getLatestEventIdForReplay(options);
	}

	async close() {
		if (this.syncTimer) {
			clearInterval(this.syncTimer);
			this.syncTimer = null;
		}
		await this.terminal.close();
		await this.runtime.close();
		await this.startPromise?.catch(() => {});
		await this.syncPromise?.catch(() => {});
		this.store.close();
	}
	private async beginLifecycleOperation(
		threadId: string,
		kind: ThreadOperationKind,
	) {
		const operation = this.store.beginThreadOperation(threadId, kind);
		this.projection.publish("thread.lifecycle.updated", threadId, null, {
			thread: this.store.getThread(threadId),
			operation,
		});
		return this.runLifecycleOperation(operation);
	}

	private async runLifecycleOperation(operation: ThreadOperation) {
		this.store.markThreadOperationRunning(operation.id);
		try {
			if (operation.kind === "archive") {
				await this.runtime.archiveThread(operation.threadId);
			} else {
				await this.runtime.unarchiveThread(operation.threadId);
			}
			return this.projection.confirmThreadLifecycle(
				operation.threadId,
				operation.kind,
			);
		} catch (error) {
			const current = this.store.getThread(operation.threadId);
			if (
				current?.remoteArchived === (operation.kind === "archive") &&
				current.lifecycleState ===
					(operation.kind === "archive" ? "archived" : "active")
			) {
				return this.projection.confirmThreadLifecycle(
					operation.threadId,
					operation.kind,
				);
			}
			const message = error instanceof Error ? error.message : String(error);
			if (isTransientRuntimeError(message)) {
				return this.store.getThread(operation.threadId);
			}
			const thread = this.store.failThreadOperation(
				operation.threadId,
				operation.kind,
				message,
			);
			this.projection.publish(
				"thread.lifecycle.updated",
				operation.threadId,
				null,
				{
					thread,
					operation: this.store.getThreadOperation(operation.id),
				},
			);
			return thread;
		}
	}

	private async recoverThreadOperations() {
		for (const operation of this.store.listPendingThreadOperations()) {
			await this.runLifecycleOperation(operation);
		}
	}

	private async startShellCommand(
		thread: ControlThread,
		prompt: string,
		command: string,
	) {
		const { runtimeTurn, thread: runtimeThread } =
			await this.startRuntimeShellCommand(thread, command);
		return this.projection.recordTurn(runtimeThread, prompt, runtimeTurn);
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
				await this.runtime.steerTurn({
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
				this.runtime.startTurn({
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
			runtimeTurn: result.value,
		};
	}

	private async startRuntimeShellCommand(
		thread: ControlThread,
		command: string,
	) {
		const result = await this.runRuntimeAction(
			thread,
			(runtimeThread) =>
				this.runtime.runShellCommand({
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
			runtimeTurn: result.value,
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
			const runtimeThread = await this.runtime.resumeThread({
				threadId: thread.id,
				cwd: thread.cwd,
				model: thread.model,
			});
			this.projection.applyRuntimeThreadSnapshot(thread, runtimeThread);
			this.projection.publish("thread.resumed", thread.id, null, {
				thread: this.store.getThread(thread.id),
			});
			return this.store.getThread(thread.id) ?? thread;
		} catch (error) {
			if (isRuntimeThreadNotFoundError(error)) {
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
			name: source.name,
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
			name: string;
			preview: string;
			eventReason: "manual" | "runtime_missing";
			markSourceLost: boolean;
		},
	) {
		if (input.markSourceLost) {
			this.projection.markRuntimeThreadLost(source);
		}
		const runtimeThread = await this.runtime.forkThread({
			sourceThreadId: source.id,
			cwd: input.cwd,
			name: input.name,
			model: input.model,
		});
		const thread = this.projection.createThread(
			{
				runtimeThread,
				name: input.name,
				forkedFromId: source.id,
				goalObjective: source.goalObjective,
				goalStatus: source.goalStatus,
				goalTokenBudget: source.goalTokenBudget,
				preview: input.preview,
				tokensUsed: source.tokensUsed,
			},
			{
				type: "thread.forked",
				payload: {
					sourceThreadId: source.id,
					reason: input.eventReason,
				},
			},
		);
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

function isTransientRuntimeError(message: string) {
	return /websocket|not connected|closed|connect|ECONN|timeout|timed out/i.test(
		message,
	);
}
