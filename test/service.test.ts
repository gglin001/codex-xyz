import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
	type RuntimeThreadHistorySnapshot,
	RuntimeThreadNotFoundError,
	type RuntimeThreadSearchInput,
	type RuntimeThreadSearchPage,
	type RuntimeThreadSnapshot,
	type RuntimeTurnSnapshot,
	type StartRuntimeTurnInput,
	type StartThreadInput,
} from "../src/server/codex/runtimePort.js";
import { ControlService } from "../src/server/service.js";
import { Store } from "../src/server/store.js";
import { TestCodexRuntime } from "./testCodexRuntime.js";

let tempDir: string;
let service: ControlService;
let testRuntime: TestCodexRuntime;

function emptyBackgroundTerminals(): {
	terminals: RuntimeBackgroundTerminal[];
	nextCursor: string | null;
} {
	return {
		terminals: [],
		nextCursor: null,
	};
}

async function waitForEvents() {
	await new Promise((resolve) => setTimeout(resolve, 20));
}

async function waitForCondition(condition: () => boolean) {
	for (let attempt = 0; attempt < 50; attempt += 1) {
		if (condition()) {
			return;
		}
		await waitForEvents();
	}
	throw new Error("Timed out waiting for condition");
}

class PagedSearchCodexRuntime extends TestCodexRuntime {
	readonly searchInputs: RuntimeThreadSearchInput[] = [];

	constructor(private readonly pages: Map<string, RuntimeThreadSearchPage>) {
		super();
	}

	async searchThreads(input: RuntimeThreadSearchInput) {
		this.searchInputs.push({ ...input });
		return (
			this.pages.get(input.cursor ?? "first") ?? {
				results: [],
				nextCursor: null,
			}
		);
	}
}

class VolatileCodexRuntime implements CodexRuntime {
	readonly name = "volatile";
	readonly version = "test";
	private handler: RuntimeEventHandler = () => {};
	private readonly loadedThreads = new Map<string, RuntimeThreadSnapshot>();
	private readonly persistedThreads = new Map<string, RuntimeThreadSnapshot>();
	private readonly archivedThreads = new Map<string, RuntimeThreadSnapshot>();
	private readonly histories = new Map<string, RuntimeThreadHistorySnapshot>();
	private readonly missingGoalThreads = new Set<string>();
	private readonly timers = new Set<NodeJS.Timeout>();
	private readonly failedArchives = new Set<string>();
	private readonly transientArchives = new Set<string>();
	failArchivedList = false;
	private nextThread = 1;
	private nextTurn = 1;
	listThreadCalls = 0;
	readThreadCalls = 0;
	readThreadHistoryCalls = 0;

	onEvent(handler: RuntimeEventHandler) {
		this.handler = handler;
	}

	async readConfig() {
		return {
			model: "volatile-model",
			modelProvider: "test-provider",
			serviceTier: null,
		};
	}

	async listThreads(input: { archived?: boolean | null } = {}) {
		this.listThreadCalls += 1;
		if (input.archived && this.failArchivedList) {
			throw new Error("archived list unavailable");
		}
		return {
			threads: [
				...(input.archived
					? this.archivedThreads.values()
					: this.persistedThreads.values()),
			],
			nextCursor: null,
		};
	}

	async searchThreads(input: { query: string }) {
		const query = input.query.toLowerCase();
		return {
			results: [...this.persistedThreads.values()]
				.filter((thread) => thread.preview.toLowerCase().includes(query))
				.map((thread) => ({ thread, snippet: thread.preview })),
			nextCursor: null,
		};
	}

	async readThread(threadId: string) {
		this.readThreadCalls += 1;
		const thread = this.persistedThreads.get(threadId);
		if (!thread) throw new RuntimeThreadNotFoundError(threadId);
		return thread;
	}

	async readThreadHistory(threadId: string) {
		this.readThreadHistoryCalls += 1;
		return this.histories.get(threadId) ?? { turns: [], nextCursor: null };
	}

	persistThread(thread: RuntimeThreadSnapshot, loaded = true) {
		this.persistedThreads.set(thread.id, thread);
		if (loaded) {
			this.loadedThreads.set(thread.id, thread);
		}
	}

	setThreadHistory(threadId: string, history: RuntimeThreadHistorySnapshot) {
		this.histories.set(threadId, history);
	}

	emit(event: RuntimeEvent) {
		this.handler(event);
	}

	forgetThread(threadId: string) {
		this.loadedThreads.delete(threadId);
	}

	failSetGoal(threadId: string) {
		this.missingGoalThreads.add(threadId);
	}

	async startThread(input: StartThreadInput): Promise<RuntimeThreadSnapshot> {
		const id = `volatile_thread_${this.nextThread++}`;
		const thread: RuntimeThreadSnapshot = {
			id,
			sessionId: id,
			forkedFromId: null,
			parentThreadId: null,
			sourceKind: "app_server",
			agentNickname: null,
			agentRole: null,
			name: input.name?.trim() || null,
			preview: input.preview,
			cwd: input.cwd,
			model: input.model ?? "volatile-model",
			status: "idle",
		};
		this.loadedThreads.set(id, thread);
		this.persistedThreads.set(id, thread);
		return thread;
	}

	async resumeThread(input: ResumeThreadInput): Promise<RuntimeThreadSnapshot> {
		return this.requireThread(input.threadId);
	}

	async startTurn(input: StartRuntimeTurnInput): Promise<RuntimeTurnSnapshot> {
		this.requireThread(input.threadId);
		const turn: RuntimeTurnSnapshot = {
			id: `volatile_turn_${this.nextTurn++}`,
			status: "in_progress",
		};
		const timer = setTimeout(() => {
			this.timers.delete(timer);
			this.handler({
				type: "turn.status",
				threadId: input.threadId,
				turnId: turn.id,
				status: "completed",
				durationMs: 0,
			});
		}, 0);
		this.timers.add(timer);
		return turn;
	}

	async runShellCommand(
		input: RunShellCommandInput,
	): Promise<RuntimeTurnSnapshot> {
		return this.startTurn({
			threadId: input.threadId,
			prompt: `!${input.command}`,
		});
	}

	async compactThread(input: CompactThreadInput): Promise<RuntimeTurnSnapshot> {
		return this.startTurn({
			threadId: input.threadId,
			prompt: "/compact",
		});
	}

	async steerTurn(input: { threadId: string }) {
		this.requireThread(input.threadId);
	}

	async interruptTurn(input: { threadId: string }) {
		this.requireThread(input.threadId);
	}

	async forkThread(input: ForkThreadInput): Promise<RuntimeThreadSnapshot> {
		const source = this.requirePersistedThread(input.sourceThreadId);
		const fork = await this.startThread({
			cwd: input.cwd,
			name: input.name,
			model: input.model ?? source.model,
			preview: `Fork of ${source.preview}`,
		});
		const forkedThread = {
			...fork,
			sessionId: source.sessionId,
			forkedFromId: source.id,
		};
		this.loadedThreads.set(forkedThread.id, forkedThread);
		this.persistedThreads.set(forkedThread.id, forkedThread);
		return forkedThread;
	}

	async archiveThread(threadId: string) {
		if (this.transientArchives.has(threadId)) {
			throw new Error("app-server websocket is not connected");
		}
		if (this.failedArchives.has(threadId)) {
			throw new Error("archive rejected");
		}
		const thread = this.requirePersistedThread(threadId);
		this.loadedThreads.delete(threadId);
		this.persistedThreads.delete(threadId);
		this.archivedThreads.set(threadId, thread);
		this.handler({
			type: "thread.archived",
			threadId,
		});
	}

	failArchive(threadId: string) {
		this.failedArchives.add(threadId);
	}

	failArchiveTransiently(threadId: string) {
		this.transientArchives.add(threadId);
	}

	async unarchiveThread(threadId: string) {
		const thread = this.archivedThreads.get(threadId);
		if (!thread) throw new RuntimeThreadNotFoundError(threadId);
		this.archivedThreads.delete(threadId);
		this.persistedThreads.set(threadId, thread);
		this.handler({ type: "thread.unarchived", threadId });
	}

	archiveSilently(threadId: string) {
		const thread = this.requirePersistedThread(threadId);
		this.loadedThreads.delete(threadId);
		this.persistedThreads.delete(threadId);
		this.archivedThreads.set(threadId, thread);
	}

	returnThreadOnBothLifecycleSides(threadId: string) {
		this.archivedThreads.set(threadId, this.requirePersistedThread(threadId));
	}

	async setThreadName(input: { threadId: string; name: string }) {
		const thread = this.requireThread(input.threadId);
		const name = input.name.trim();
		if (!name) {
			return;
		}
		const updated = { ...thread, name };
		this.loadedThreads.set(input.threadId, updated);
		this.persistedThreads.set(input.threadId, updated);
		this.handler({
			type: "thread.name.updated",
			threadId: input.threadId,
			name,
		});
	}

	async setGoal(input: {
		threadId: string;
		objective: string;
		tokenBudget?: number | null;
	}): Promise<RuntimeGoalSnapshot> {
		this.requireThread(input.threadId);
		if (this.missingGoalThreads.has(input.threadId)) {
			throw new RuntimeThreadNotFoundError(
				input.threadId,
				`thread not found: ${input.threadId}`,
			);
		}
		return {
			objective: input.objective,
			status: "in_progress",
			tokenBudget: input.tokenBudget ?? null,
			tokensUsed: 0,
		};
	}

	async setGoalStatus(input: {
		threadId: string;
		status: "active" | "paused" | "complete";
	}): Promise<RuntimeGoalSnapshot> {
		this.requireThread(input.threadId);
		return {
			objective: "Test goal",
			status: input.status === "active" ? "in_progress" : input.status,
			tokenBudget: null,
			tokensUsed: 0,
		};
	}

	async startGoal(input: {
		threadId: string;
		objective: string;
		tokenBudget?: number | null;
	}): Promise<RuntimeGoalStart> {
		const goal = await this.setGoal(input);
		const turn = await this.startTurn({
			threadId: input.threadId,
			prompt: "",
		});
		return { goal, turn };
	}

	async getGoal(threadId: string) {
		this.requireThread(threadId);
		return null;
	}

	async clearGoal(threadId: string) {
		this.requireThread(threadId);
	}

	async listBackgroundTerminals() {
		return emptyBackgroundTerminals();
	}

	async cleanBackgroundTerminals() {}

	async restartAppServer() {
		return {
			status: "restarted" as const,
			pid: null,
			socketPath: "volatile://codex-app-server",
		};
	}

	async close() {
		for (const timer of this.timers) {
			clearTimeout(timer);
		}
		this.timers.clear();
	}

	private requireThread(threadId: string) {
		const thread = this.loadedThreads.get(threadId);
		if (!thread) {
			throw new RuntimeThreadNotFoundError(
				threadId,
				`thread not found: ${threadId}`,
			);
		}
		return thread;
	}

	private requirePersistedThread(threadId: string) {
		const thread = this.persistedThreads.get(threadId);
		if (!thread) {
			throw new RuntimeThreadNotFoundError(
				threadId,
				`thread not found: ${threadId}`,
			);
		}
		return thread;
	}
}

class EagerEventCodexRuntime implements CodexRuntime {
	readonly name = "eager";
	readonly version = "test";
	private handler: RuntimeEventHandler = () => {};
	private readonly threads = new Map<string, RuntimeThreadSnapshot>();
	private nextThread = 1;
	private nextTurn = 1;

	onEvent(handler: RuntimeEventHandler) {
		this.handler = handler;
	}

	async readConfig() {
		return {
			model: "eager-model",
			modelProvider: "test-provider",
			serviceTier: null,
		};
	}

	async listThreads(input: { archived?: boolean | null } = {}) {
		return {
			threads: input.archived ? [] : [...this.threads.values()],
			nextCursor: null,
		};
	}

	async searchThreads() {
		return { results: [], nextCursor: null };
	}

	async readThread(threadId: string) {
		const thread = this.threads.get(threadId);
		if (!thread) throw new RuntimeThreadNotFoundError(threadId);
		return thread;
	}

	async readThreadHistory() {
		return { turns: [], nextCursor: null };
	}

	async startThread(input: StartThreadInput): Promise<RuntimeThreadSnapshot> {
		const id = `eager_thread_${this.nextThread++}`;
		const thread: RuntimeThreadSnapshot = {
			id,
			sessionId: id,
			forkedFromId: null,
			parentThreadId: null,
			sourceKind: "app_server",
			agentNickname: null,
			agentRole: null,
			name: input.name?.trim() || null,
			preview: input.preview,
			cwd: input.cwd,
			model: input.model ?? "eager-model",
			status: "idle",
		};
		this.threads.set(id, thread);
		return thread;
	}

	async resumeThread(input: ResumeThreadInput): Promise<RuntimeThreadSnapshot> {
		return this.requireThread(input.threadId);
	}

	async startTurn(input: StartRuntimeTurnInput): Promise<RuntimeTurnSnapshot> {
		this.requireThread(input.threadId);
		const turn: RuntimeTurnSnapshot = {
			id: `eager_turn_${this.nextTurn++}`,
			status: "in_progress",
		};
		const answerId = `eager_item_${turn.id}`;
		this.handler({
			type: "item.created",
			threadId: input.threadId,
			turnId: turn.id,
			itemId: answerId,
			itemType: "agent",
			text: "",
			data: { runtime: "eager" },
		});
		this.handler({
			type: "item.delta",
			threadId: input.threadId,
			turnId: turn.id,
			itemId: answerId,
			delta: `Answered before return: ${input.prompt}`,
		});
		this.handler({
			type: "turn.status",
			threadId: input.threadId,
			turnId: turn.id,
			status: "completed",
			durationMs: 1,
		});
		return turn;
	}

	async runShellCommand(
		input: RunShellCommandInput,
	): Promise<RuntimeTurnSnapshot> {
		return this.startTurn({
			threadId: input.threadId,
			prompt: `!${input.command}`,
			model: null,
		});
	}

	async compactThread(input: CompactThreadInput): Promise<RuntimeTurnSnapshot> {
		return this.startTurn({
			threadId: input.threadId,
			prompt: "/compact",
			model: null,
		});
	}

	async steerTurn(input: { threadId: string }) {
		this.requireThread(input.threadId);
	}

	async interruptTurn(input: { threadId: string }) {
		this.requireThread(input.threadId);
	}

	async forkThread(input: ForkThreadInput): Promise<RuntimeThreadSnapshot> {
		const source = this.requireThread(input.sourceThreadId);
		const id = `eager_thread_${this.nextThread++}`;
		const thread: RuntimeThreadSnapshot = {
			id,
			sessionId: source.sessionId,
			forkedFromId: source.id,
			parentThreadId: null,
			sourceKind: "app_server",
			agentNickname: null,
			agentRole: null,
			name: input.name?.trim() || null,
			preview: `Fork of ${source.preview}`,
			cwd: input.cwd,
			model: input.model ?? source.model,
			status: "idle",
		};
		this.threads.set(id, thread);
		return thread;
	}

	async archiveThread(threadId: string) {
		this.requireThread(threadId);
		this.threads.delete(threadId);
		this.handler({
			type: "thread.archived",
			threadId,
		});
	}

	async unarchiveThread(threadId: string) {
		throw new RuntimeThreadNotFoundError(threadId);
	}

	async setThreadName(input: { threadId: string; name: string }) {
		const thread = this.requireThread(input.threadId);
		const name = input.name.trim();
		if (!name) {
			return;
		}
		this.threads.set(input.threadId, { ...thread, name });
		this.handler({
			type: "thread.name.updated",
			threadId: input.threadId,
			name,
		});
	}

	async setGoal(input: {
		threadId: string;
		objective: string;
		tokenBudget?: number | null;
	}): Promise<RuntimeGoalSnapshot> {
		this.requireThread(input.threadId);
		return {
			objective: input.objective,
			status: "in_progress",
			tokenBudget: input.tokenBudget ?? null,
			tokensUsed: 0,
		};
	}

	async setGoalStatus(input: {
		threadId: string;
		status: "active" | "paused" | "complete";
	}): Promise<RuntimeGoalSnapshot> {
		this.requireThread(input.threadId);
		return {
			objective: "Test goal",
			status: input.status === "active" ? "in_progress" : input.status,
			tokenBudget: null,
			tokensUsed: 0,
		};
	}

	async startGoal(input: {
		threadId: string;
		objective: string;
		tokenBudget?: number | null;
	}): Promise<RuntimeGoalStart> {
		const goal = await this.setGoal(input);
		const turn = await this.startTurn({
			threadId: input.threadId,
			prompt: "",
			model: null,
		});
		return { goal, turn };
	}

	async getGoal(threadId: string) {
		this.requireThread(threadId);
		return null;
	}

	async clearGoal(threadId: string) {
		this.requireThread(threadId);
	}

	async listBackgroundTerminals() {
		return emptyBackgroundTerminals();
	}

	async cleanBackgroundTerminals() {}

	async restartAppServer() {
		return {
			status: "restarted" as const,
			pid: null,
			socketPath: "eager://codex-app-server",
		};
	}

	async close() {
		this.threads.clear();
	}

	private requireThread(threadId: string) {
		const thread = this.threads.get(threadId);
		if (!thread) {
			throw new RuntimeThreadNotFoundError(
				threadId,
				`thread not found: ${threadId}`,
			);
		}
		return thread;
	}
}

class InterruptDriftCodexRuntime implements CodexRuntime {
	readonly name = "interrupt-drift";
	readonly version = "test";
	handler: RuntimeEventHandler = () => {};
	private thread: RuntimeThreadSnapshot | null = null;
	private readonly activeTurnId = "drift_turn_1";

	onEvent(handler: RuntimeEventHandler) {
		this.handler = handler;
	}

	async readConfig() {
		return {
			model: "drift-model",
			modelProvider: "test-provider",
			serviceTier: null,
		};
	}

	async listThreads(input: { archived?: boolean | null } = {}) {
		return {
			threads: input.archived || !this.thread ? [] : [this.thread],
			nextCursor: null,
		};
	}

	async searchThreads() {
		return { results: [], nextCursor: null };
	}

	async readThread(threadId: string) {
		if (!this.thread || this.thread.id !== threadId) {
			throw new RuntimeThreadNotFoundError(threadId);
		}
		return this.thread;
	}

	async readThreadHistory() {
		return { turns: [], nextCursor: null };
	}

	async startThread(input: StartThreadInput): Promise<RuntimeThreadSnapshot> {
		const thread: RuntimeThreadSnapshot = {
			id: "drift_thread_1",
			sessionId: "drift_thread_1",
			forkedFromId: null,
			parentThreadId: null,
			sourceKind: "app_server",
			agentNickname: null,
			agentRole: null,
			name: input.name?.trim() || null,
			preview: input.preview,
			cwd: input.cwd,
			model: input.model ?? "drift-model",
			status: "idle",
		};
		this.thread = thread;
		return thread;
	}

	async resumeThread(input: ResumeThreadInput): Promise<RuntimeThreadSnapshot> {
		if (!this.thread || this.thread.id !== input.threadId) {
			throw new RuntimeThreadNotFoundError(
				input.threadId,
				`thread not found: ${input.threadId}`,
			);
		}
		this.thread = {
			...this.thread,
			status: "idle",
			activeTurnId: null,
		};
		return this.thread;
	}

	async startTurn(input: StartRuntimeTurnInput): Promise<RuntimeTurnSnapshot> {
		if (!this.thread || this.thread.id !== input.threadId) {
			throw new RuntimeThreadNotFoundError(
				input.threadId,
				`thread not found: ${input.threadId}`,
			);
		}
		this.thread = {
			...this.thread,
			status: "active",
			activeTurnId: this.activeTurnId,
		};
		return {
			id: this.activeTurnId,
			status: "in_progress",
		};
	}

	async runShellCommand(
		input: RunShellCommandInput,
	): Promise<RuntimeTurnSnapshot> {
		return this.startTurn({
			threadId: input.threadId,
			prompt: `!${input.command}`,
			model: null,
		});
	}

	async compactThread(input: CompactThreadInput): Promise<RuntimeTurnSnapshot> {
		return this.startTurn({
			threadId: input.threadId,
			prompt: "/compact",
			model: null,
		});
	}

	async steerTurn() {}

	async interruptTurn(input: { threadId: string }) {
		throw new RuntimeThreadNotFoundError(
			input.threadId,
			`no rollout found for thread id ${input.threadId}`,
		);
	}

	async forkThread(input: ForkThreadInput): Promise<RuntimeThreadSnapshot> {
		return this.startThread({
			cwd: input.cwd,
			name: input.name,
			model: input.model,
			preview: "fork",
		});
	}

	async archiveThread(threadId: string) {
		if (!this.thread || this.thread.id !== threadId) {
			throw new RuntimeThreadNotFoundError(
				threadId,
				`thread not found: ${threadId}`,
			);
		}
		this.thread = null;
		this.handler({
			type: "thread.archived",
			threadId,
		});
	}

	async unarchiveThread(threadId: string) {
		throw new RuntimeThreadNotFoundError(threadId);
	}

	async setThreadName(input: { name: string }) {
		if (this.thread) {
			this.thread = {
				...this.thread,
				name: input.name.trim() || this.thread.name,
			};
		}
	}

	async setGoal(input: {
		objective: string;
		tokenBudget?: number | null;
	}): Promise<RuntimeGoalSnapshot> {
		return {
			objective: input.objective,
			status: "in_progress",
			tokenBudget: input.tokenBudget ?? null,
			tokensUsed: 0,
		};
	}

	async setGoalStatus(input: {
		status: "active" | "paused" | "complete";
	}): Promise<RuntimeGoalSnapshot> {
		return {
			objective: "Test goal",
			status: input.status === "active" ? "in_progress" : input.status,
			tokenBudget: null,
			tokensUsed: 0,
		};
	}

	async startGoal(input: {
		threadId: string;
		objective: string;
		tokenBudget?: number | null;
	}): Promise<RuntimeGoalStart> {
		return {
			goal: await this.setGoal(input),
			turn: await this.startTurn({
				threadId: input.threadId,
				prompt: "",
				model: null,
			}),
		};
	}

	async getGoal() {
		return null;
	}

	async clearGoal() {}

	async listBackgroundTerminals() {
		return emptyBackgroundTerminals();
	}

	async cleanBackgroundTerminals() {}

	async restartAppServer() {
		return {
			status: "restarted" as const,
			pid: null,
			socketPath: "drift://codex-app-server",
		};
	}

	async close() {
		this.thread = null;
		this.handler = () => {};
	}
}

beforeEach(() => {
	tempDir = mkdtempSync(join(tmpdir(), "coz-service-"));
	testRuntime = new TestCodexRuntime();
	service = new ControlService(
		Store.open(join(tempDir, "test.sqlite")),
		testRuntime,
	);
	service.seedLocalState({
		cwd: tempDir,
		runtimeName: "test",
		cliVersion: "test",
	});
});

afterEach(async () => {
	await service.close();
	rmSync(tempDir, { recursive: true, force: true });
});

describe("ControlService", () => {
	it("fills history search pages with main threads after filtering subagents", async () => {
		await service.close();
		const thread = (
			id: string,
			sourceKind: RuntimeThreadSnapshot["sourceKind"],
			parentThreadId: string | null,
		): RuntimeThreadSnapshot => ({
			id,
			sessionId: id,
			forkedFromId: null,
			parentThreadId,
			sourceKind,
			agentNickname: sourceKind === "subagent" ? id : null,
			agentRole: null,
			name: id,
			preview: "shared search result",
			cwd: tempDir,
			model: null,
			status: "idle",
			updatedAt: "2026-07-12T00:00:00.000Z",
		});
		const result = (threadSnapshot: RuntimeThreadSnapshot) => ({
			thread: threadSnapshot,
			snippet: threadSnapshot.preview,
		});
		const runtime = new PagedSearchCodexRuntime(
			new Map([
				[
					"first",
					{
						results: [
							result(thread("child-source", "subagent", "root")),
							result(thread("child-parent", "unknown", "root")),
						],
						nextCursor: "second",
					},
				],
				[
					"second",
					{
						results: [
							result(thread("main-one", "vscode", null)),
							result(thread("child-two", "subagent", "root")),
						],
						nextCursor: "third",
					},
				],
				[
					"third",
					{
						results: [result(thread("main-two", "cli", null))],
						nextCursor: "fourth",
					},
				],
			]),
		);
		service = new ControlService(
			Store.open(join(tempDir, "paged-search.sqlite")),
			runtime,
		);
		service.seedLocalState({ cwd: tempDir, runtimeName: runtime.name });

		const page = await service.searchThreadHistory({
			query: "shared",
			limit: 2,
		});

		expect(page.results.map((entry) => entry.thread.id)).toEqual([
			"main-one",
			"main-two",
		]);
		expect(page.nextCursor).toBe("fourth");
		expect(
			runtime.searchInputs.map(({ cursor, limit }) => ({ cursor, limit })),
		).toEqual([
			{ cursor: null, limit: 2 },
			{ cursor: "second", limit: 2 },
			{ cursor: "third", limit: 1 },
		]);
	});

	it("discovers an unknown subagent and replays buffered events", async () => {
		await service.close();
		const runtime = new VolatileCodexRuntime();
		service = new ControlService(
			Store.open(join(tempDir, "subagent-discovery.sqlite")),
			runtime,
		);
		service.seedLocalState({ cwd: tempDir, runtimeName: runtime.name });
		runtime.persistThread({
			id: "thread-child",
			sessionId: "thread-child",
			forkedFromId: null,
			parentThreadId: "thread-parent",
			sourceKind: "subagent",
			agentNickname: "scout",
			agentRole: "Inspect runtime events",
			name: null,
			preview: "Inspect runtime events",
			cwd: tempDir,
			model: "volatile-model",
			status: "active",
			updatedAt: "2026-07-12T00:00:00.000Z",
		});

		runtime.emit({
			type: "turn.started",
			threadId: "thread-child",
			turnId: "turn-child",
			prompt: "Inspect runtime events",
		});
		runtime.emit({
			type: "item.created",
			threadId: "thread-child",
			turnId: "turn-child",
			itemId: "item-child",
			itemType: "agent",
			text: "Child is working",
		});

		await waitForCondition(() => service.store.getItem("item-child") !== null);

		expect(runtime.readThreadCalls).toBe(1);
		expect(service.store.getThread("thread-child")).toMatchObject({
			parentThreadId: "thread-parent",
			sourceKind: "subagent",
			agentNickname: "scout",
			activeTurnId: "turn-child",
		});
		expect(service.store.getTurn("turn-child")).toMatchObject({
			threadId: "thread-child",
			status: "in_progress",
		});
		expect(service.store.getItem("item-child")).toMatchObject({
			threadId: "thread-child",
			turnId: "turn-child",
			text: "Child is working",
		});
		expect(
			service.replayEvents(0, { summaryOnly: true }).map((event) => event.type),
		).toEqual(["thread.discovered", "turn.started"]);
	});

	it("rehydrates history after a runtime event invalidates the cache", async () => {
		await service.close();
		const runtime = new VolatileCodexRuntime();
		service = new ControlService(
			Store.open(join(tempDir, "subagent-rehydrate.sqlite")),
			runtime,
		);
		service.seedLocalState({ cwd: tempDir, runtimeName: runtime.name });
		const thread: RuntimeThreadSnapshot = {
			id: "thread-history",
			sessionId: "thread-history",
			forkedFromId: null,
			parentThreadId: "thread-parent",
			sourceKind: "subagent",
			agentNickname: "historian",
			agentRole: null,
			name: null,
			preview: "History",
			cwd: tempDir,
			model: "volatile-model",
			status: "idle",
			updatedAt: "2026-07-12T00:00:00.000Z",
		};
		const runtimeTurn = {
			id: "turn-history",
			status: "completed" as const,
			prompt: "Inspect history",
			startedAt: "2026-07-12T00:00:00.000Z",
			completedAt: "2026-07-12T00:00:01.000Z",
			durationMs: 1000,
			items: [],
		};
		runtime.persistThread(thread, false);
		runtime.setThreadHistory("thread-history", {
			turns: [runtimeTurn],
			nextCursor: null,
		});
		await service.syncThreads();
		await service.getHydratedThreadDetail("thread-history");

		runtime.setThreadHistory("thread-history", {
			turns: [
				{
					...runtimeTurn,
					items: [
						{
							id: "item-history",
							type: "agent",
							text: "Recovered history",
							data: { sourceType: "agentMessage" },
							createdAt: "2026-07-12T00:00:00.500Z",
						},
					],
				},
			],
			nextCursor: null,
		});
		runtime.emit({
			type: "thread.token_usage",
			threadId: "thread-history",
			turnId: "turn-history",
			usage: {
				totalTokens: 10,
				inputTokens: 8,
				cachedInputTokens: 0,
				outputTokens: 2,
				reasoningOutputTokens: 0,
				modelContextWindow: 128_000,
			},
		});
		const detail = await service.getHydratedThreadDetail("thread-history");
		await service.getHydratedThreadDetail("thread-history");

		expect(runtime.readThreadHistoryCalls).toBe(2);
		expect(detail.items).toMatchObject([
			{ id: "item-history", text: "Recovered history" },
		]);
	});

	it("isolates projection failures and resynchronizes canonical state", async () => {
		await service.close();
		const runtime = new VolatileCodexRuntime();
		service = new ControlService(
			Store.open(join(tempDir, "projection-recovery.sqlite")),
			runtime,
		);
		service.seedLocalState({ cwd: tempDir, runtimeName: runtime.name });
		const created = await service.createThread({
			cwd: tempDir,
			prompt: "Initial name",
		});
		await waitForEvents();
		const thread = created.thread;
		if (!thread) throw new Error("Expected created thread");
		const renamed = { ...thread, name: "Canonical runtime name" };
		runtime.persistThread(renamed);
		const appendEvent = vi.spyOn(service.store, "appendEvent");
		appendEvent.mockImplementationOnce(() => {
			throw new Error("injected projection failure");
		});
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => {});

		expect(() =>
			runtime.emit({
				type: "thread.name.updated",
				threadId: thread.id,
				name: "Canonical runtime name",
			}),
		).not.toThrow();
		await waitForCondition(
			() =>
				service.store.getThread(thread.id)?.name === "Canonical runtime name",
		);

		expect(runtime.listThreadCalls).toBeGreaterThanOrEqual(2);
		expect(consoleError).toHaveBeenCalled();
		appendEvent.mockRestore();
		consoleError.mockRestore();
	});

	it("rejects direct prompt and goal input for child subagents", async () => {
		await service.close();
		const runtime = new VolatileCodexRuntime();
		service = new ControlService(
			Store.open(join(tempDir, "subagent-input.sqlite")),
			runtime,
		);
		service.seedLocalState({ cwd: tempDir, runtimeName: runtime.name });
		runtime.persistThread({
			id: "thread-child",
			sessionId: "thread-child",
			forkedFromId: null,
			parentThreadId: "thread-parent",
			sourceKind: "subagent",
			agentNickname: "worker",
			agentRole: null,
			name: null,
			preview: "Child",
			cwd: tempDir,
			model: "volatile-model",
			status: "idle",
			updatedAt: "2026-07-12T00:00:00.000Z",
		});
		await service.syncThreads();

		await expect(
			service.startTurn({
				threadId: "thread-child",
				prompt: "Direct prompt",
			}),
		).rejects.toThrow("Direct input is not supported");
		await expect(
			service.startGoal({
				threadId: "thread-child",
				objective: "Direct goal",
				tokenBudget: null,
			}),
		).rejects.toThrow("Direct input is not supported");
		expect(service.store.listTurns("thread-child")).toEqual([]);
	});

	it("creates a thread, starts a turn, records transcript items, and completes", async () => {
		const result = await service.createThread({
			cwd: tempDir,
			prompt: "Implement local test support",
			name: "Local test support",
		});
		expect(result.thread?.status).toBe("active");
		expect(result.thread?.name).toBe("Local test support");

		await waitForEvents();

		const threads = service.listThreads();
		expect(threads).toHaveLength(1);
		expect(threads[0].status).toBe("idle");

		const detail = service.getThreadDetail(threads[0].id);
		expect(detail.name).toBe("Local test support");
		expect(detail.turns).toHaveLength(1);
		expect(detail.turns[0].status).toBe("completed");
		expect(
			detail.items.some(
				(item) =>
					item.type === "agent" && item.text.includes("Test run started"),
			),
		).toBe(true);
	});

	it("lists and cleans runtime background terminals", async () => {
		const result = await service.createThread({
			cwd: tempDir,
			prompt: "Start terminal work",
		});
		const threadId = result.thread?.id;
		if (!threadId) {
			throw new Error("Expected created thread id");
		}
		testRuntime.backgroundTerminals = [
			{
				itemId: "item_terminal",
				processId: "process_1",
				command: "pnpm dev",
				cwd: tempDir,
				osPid: 123,
				cpuPercent: 0.5,
				rssKb: 2048,
			},
		];

		await waitForEvents();
		const page = await service.listBackgroundTerminals(threadId);
		const thread = await service.cleanBackgroundTerminals(threadId);

		expect(page.terminals).toHaveLength(1);
		expect(page.terminals[0].command).toBe("pnpm dev");
		expect(thread?.id).toBe(threadId);
		expect(testRuntime.backgroundTerminalsCleanCount).toBe(1);
		expect(testRuntime.backgroundTerminals).toEqual([]);
	});

	it("creates a goal thread and starts the first goal turn", async () => {
		const result = await service.createThread({
			cwd: tempDir,
			prompt: "Finish the first-version MVP",
			goalMode: true,
		});

		const threadId = result.thread?.id;
		if (!threadId) {
			throw new Error("Expected created thread id");
		}

		expect(result.turn).toMatchObject({
			threadId,
			status: "in_progress",
			prompt: "",
		});
		expect(result.goal?.objective).toBe("Finish the first-version MVP");
		expect(result.thread?.goalObjective).toBe("Finish the first-version MVP");
		expect(result.thread?.goalStatus).toBe("in_progress");
		expect(result.thread?.status).toBe("active");

		await waitForEvents();

		const detail = service.getThreadDetail(threadId);
		expect(detail.turns).toHaveLength(1);
		expect(detail.turns[0]).toMatchObject({
			prompt: "",
			status: "completed",
		});
		expect(detail.goalObjective).toBe("Finish the first-version MVP");
		expect(
			detail.items.some(
				(item) =>
					item.type === "agent" && item.text.includes("Goal work started"),
			),
		).toBe(true);
	});

	it("keeps dashboard snapshots and summary event replay separate from transcript detail", async () => {
		const result = await service.createThread({
			cwd: tempDir,
			prompt: "Exercise summary replay",
		});
		await waitForEvents();

		const threadId = result.thread?.id;
		if (!threadId) {
			throw new Error("Expected created thread id");
		}

		testRuntime.defaultModel = "configured-default-model";
		await service.start();
		const dashboard = await service.dashboard();
		const detail = service.getThreadDetail(threadId);
		const fullReplay = service.replayEvents(0, { threadId });
		const summaryReplay = service.replayEvents(0, { summaryOnly: true });

		expect(dashboard.latestEventId).toBeGreaterThan(0);
		expect(dashboard.defaultCwd).toBe(tempDir);
		expect(dashboard.defaultModel).toBe("configured-default-model");
		expect(testRuntime.lastReadConfigInput).toMatchObject({ cwd: tempDir });
		expect(dashboard.threads[0]).not.toHaveProperty("items");
		expect(detail.latestEventId).toBeGreaterThan(0);
		expect(
			detail.items.some((item) => item.text.includes("Test run started")),
		).toBe(true);
		expect(fullReplay.some((event) => event.type.startsWith("item."))).toBe(
			true,
		);
		const replayItemEvent = fullReplay.find((event) =>
			event.type.startsWith("item."),
		);
		expect(replayItemEvent?.payload).toHaveProperty("itemRef");
		expect(replayItemEvent?.payload).not.toHaveProperty("item");
		expect(summaryReplay.some((event) => event.type.startsWith("item."))).toBe(
			false,
		);
		expect(summaryReplay.some((event) => event.type === "runtime.raw")).toBe(
			false,
		);
	});

	it("records items that arrive before the runtime startTurn call returns", async () => {
		await service.close();
		const runtime = new EagerEventCodexRuntime();
		service = new ControlService(
			Store.open(join(tempDir, "eager.sqlite")),
			runtime,
		);
		service.seedLocalState({
			cwd: tempDir,
			runtimeName: runtime.name,
			cliVersion: runtime.version,
		});

		const result = await service.createThread({
			cwd: tempDir,
			prompt: "Prompt with eager runtime events",
		});
		const threadId = result.thread?.id;
		if (!threadId || !result.turn) {
			throw new Error("Expected created thread and turn");
		}

		const detail = service.getThreadDetail(threadId);
		expect(result.turn.status).toBe("completed");
		expect(detail.status).toBe("idle");
		expect(detail.turns).toHaveLength(1);
		expect(detail.turns[0].prompt).toBe("Prompt with eager runtime events");
		expect(detail.turns[0].status).toBe("completed");
		expect(
			detail.items.some((item) => item.text.includes("Answered before return")),
		).toBe(true);
	});

	it("runs bang-prefixed prompts as app-server shell commands", async () => {
		const result = await service.createThread({
			cwd: tempDir,
			prompt: "!pwd",
		});
		await waitForEvents();

		const threadId = result.thread?.id;
		if (!threadId) {
			throw new Error("Expected created thread id");
		}

		const detail = service.getThreadDetail(threadId);
		expect(detail.turns).toHaveLength(1);
		expect(detail.turns[0].prompt).toBe("!pwd");
		expect(detail.turns[0].status).toBe("completed");
		expect(
			detail.items.some(
				(item) =>
					item.type === "command" && item.text.includes(`$ pwd\n${tempDir}`),
			),
		).toBe(true);
		expect(
			detail.items.some(
				(item) =>
					item.type === "agent" && item.text.includes("Prompt preview: !pwd"),
			),
		).toBe(false);
	});

	it("steers the active turn for default submissions while a thread is running", async () => {
		const result = await service.createThread({
			cwd: tempDir,
			prompt: "Keep this turn open for steering approval",
		});
		await waitForEvents();

		const threadId = result.thread?.id;
		if (!threadId || !result.turn) {
			throw new Error("Expected created running thread and turn");
		}

		const turn = await service.startTurn({
			threadId,
			prompt: "Focus the current turn on local verification.",
		});

		const detail = service.getThreadDetail(threadId);
		expect(turn.id).toBe(result.turn.id);
		expect(detail.turns).toHaveLength(1);
		expect(
			detail.items.some(
				(item) => item.type === "agent" && item.text.includes("Steer received"),
			),
		).toBe(true);
	});

	it("starts a new turn when default submission finds no runtime active turn", async () => {
		const result = await service.createThread({
			cwd: tempDir,
			prompt: "Keep this turn open for steering approval",
		});
		await waitForEvents();

		const threadId = result.thread?.id;
		if (!threadId || !result.turn) {
			throw new Error("Expected created running thread and turn");
		}

		testRuntime.dropActiveTurn(threadId);
		const nextTurn = await service.startTurn({
			threadId,
			prompt: "Start after runtime drift.",
		});
		await waitForEvents();

		const detail = service.getThreadDetail(threadId);
		expect(nextTurn.id).not.toBe(result.turn.id);
		expect(detail.turns.map((turn) => turn.status)).toEqual([
			"interrupted",
			"completed",
		]);
		expect(detail.status).toBe("idle");
		expect(
			detail.items.some((item) =>
				item.text.includes("Prompt preview: Start after runtime drift."),
			),
		).toBe(true);
	});

	it("syncs local running state from app-server when interrupt finds no rollout", async () => {
		await service.close();
		const runtime = new InterruptDriftCodexRuntime();
		service = new ControlService(
			Store.open(join(tempDir, "interrupt-drift.sqlite")),
			runtime,
		);
		service.seedLocalState({
			cwd: tempDir,
			runtimeName: runtime.name,
			cliVersion: runtime.version,
		});

		const result = await service.createThread({
			cwd: tempDir,
			prompt: "Start a turn that drifts before interrupt",
		});
		const threadId = result.thread?.id;
		const turnId = result.turn?.id;
		if (!threadId || !turnId) {
			throw new Error("Expected created thread and turn");
		}

		const interrupted = await service.interruptTurn(threadId);
		const detail = service.getThreadDetail(threadId);

		expect(interrupted).toMatchObject({
			id: threadId,
			status: "idle",
			activeTurnId: null,
		});
		expect(detail.status).toBe("idle");
		expect(detail.activeTurnId).toBeNull();
		expect(detail.turns[0]).toMatchObject({
			id: turnId,
			status: "interrupted",
		});
	});

	it("supports the core goal controls on an existing idle thread", async () => {
		const result = await service.createThread({
			cwd: tempDir,
			prompt: "Finish setup before goal controls",
		});
		await waitForEvents();

		const threadId = result.thread?.id;
		if (!threadId) {
			throw new Error("Expected created thread id");
		}

		const goal = await service.setGoal({
			threadId,
			objective: "Finish the first-version MVP",
			tokenBudget: 1200,
		});
		expect(goal.status).toBe("in_progress");
		expect(goal.tokenBudget).toBe(1200);

		const pausedGoal = await service.setGoalStatus({
			threadId,
			status: "paused",
		});
		expect(pausedGoal.goal.status).toBe("paused");
		expect(service.getThreadDetail(threadId).goalStatus).toBe("paused");

		const resumedGoal = await service.setGoalStatus({
			threadId,
			status: "active",
		});
		expect(resumedGoal.goal.status).toBe("in_progress");
		expect(service.getThreadDetail(threadId).goalStatus).toBe("in_progress");

		const cleared = await service.clearGoal(threadId);
		expect(cleared?.goalStatus).toBe("cleared");
	});

	it("starts a goal on a persisted thread that is not currently loaded", async () => {
		const result = await service.createThread({
			cwd: tempDir,
			prompt: "Create a persisted thread before starting its goal",
		});
		await waitForEvents();

		const threadId = result.thread?.id;
		if (!threadId) {
			throw new Error("Expected created thread id");
		}
		service.store.updateThread(threadId, {
			status: "not_loaded",
			activeTurnId: null,
		});

		const started = await service.startGoal({
			threadId,
			objective: "Continue the persisted thread as a goal",
		});

		expect(started.goal).toMatchObject({
			objective: "Continue the persisted thread as a goal",
			status: "in_progress",
		});
		expect(started.turn).toMatchObject({
			threadId,
			prompt: "",
			status: "in_progress",
		});
	});

	it("forks an app-server thread and continues work on the fork", async () => {
		const result = await service.createThread({
			cwd: tempDir,
			prompt: "Build the source conversation before forking",
		});
		await waitForEvents();

		const sourceThreadId = result.thread?.id;
		if (!sourceThreadId) {
			throw new Error("Expected created thread id");
		}

		const fork = await service.forkThread({ threadId: sourceThreadId });
		expect(fork).toMatchObject({
			sessionId: sourceThreadId,
			forkedFromId: sourceThreadId,
			name: "Fork of Build the source conversation before forking",
			cwd: tempDir,
			status: "idle",
		});
		expect(testRuntime.getThreadSnapshot(fork.id)?.name).toBe(
			"Fork of Build the source conversation before forking",
		);
		expect(service.getThreadDetail(sourceThreadId).status).toBe("idle");
		expect(
			service
				.replayEvents(0, { summaryOnly: true })
				.some((event) => event.type === "thread.forked"),
		).toBe(true);

		const turn = await service.startTurn({
			threadId: fork.id,
			prompt: "Continue only on the fork",
		});
		await waitForEvents();

		expect(turn.threadId).toBe(fork.id);
		expect(service.getThreadDetail(fork.id).forkedFromId).toBe(sourceThreadId);
		expect(
			service
				.getThreadDetail(fork.id)
				.items.some((item) => item.text.includes("Continue only on the fork")),
		).toBe(true);
	});

	it("starts an app-server compact turn and records the compaction item", async () => {
		const result = await service.createThread({
			cwd: tempDir,
			prompt: "Build the source conversation before compacting",
		});
		await waitForEvents();

		const threadId = result.thread?.id;
		if (!threadId) {
			throw new Error("Expected created thread id");
		}

		const turn = await service.compactThread(threadId);
		expect(turn).toMatchObject({
			threadId,
			prompt: "/compact",
			status: "in_progress",
		});
		await waitForEvents();

		const detail = service.getThreadDetail(threadId);
		expect(detail.status).toBe("idle");
		expect(detail.turns.some((candidate) => candidate.id === turn.id)).toBe(
			true,
		);
		expect(detail.items.some((item) => item.text === "Compacted context")).toBe(
			true,
		);
	});

	it("archives idle app-server threads and hides them from default lists", async () => {
		const result = await service.createThread({
			cwd: tempDir,
			prompt: "Archive this finished thread",
		});
		await waitForEvents();

		const threadId = result.thread?.id;
		if (!threadId) {
			throw new Error("Expected created thread id");
		}

		const archived = await service.archiveThread(threadId);
		const detail = service.getThreadDetail(threadId);
		const summaryEvents = service.replayEvents(0, { summaryOnly: true });

		expect(archived).toMatchObject({
			id: threadId,
			status: "not_loaded",
			activeTurnId: null,
		});
		expect(detail.status).toBe("not_loaded");
		expect(service.listThreads()).toEqual([]);
		expect((await service.dashboard()).threads).toEqual([]);
		expect(
			summaryEvents.some((event) => event.type === "thread.archived"),
		).toBe(true);
	});

	it("keeps dashboard DB-only and reconciles external archive on sync", async () => {
		await service.close();
		const runtime = new VolatileCodexRuntime();
		service = new ControlService(
			Store.open(join(tempDir, "archive-reconciliation.sqlite")),
			runtime,
		);
		service.seedLocalState({
			cwd: tempDir,
			runtimeName: runtime.name,
			cliVersion: runtime.version,
		});

		const result = await service.createThread({
			cwd: tempDir,
			prompt: "Archive outside the control service",
		});
		await waitForEvents();
		const threadId = result.thread?.id;
		if (!threadId) {
			throw new Error("Expected created thread id");
		}

		runtime.archiveSilently(threadId);
		expect(service.listThreads().map((thread) => thread.id)).toContain(
			threadId,
		);

		const staleDashboard = await service.dashboard();
		expect(staleDashboard.threads.map((thread) => thread.id)).toContain(
			threadId,
		);

		await service.syncThreads();
		const dashboard = await service.dashboard();

		expect(dashboard.threads).toEqual([]);
		expect(service.listThreads()).toEqual([]);
		expect(service.listThreads({ archived: true })).toMatchObject([
			{
				id: threadId,
				archivedAt: expect.any(String),
			},
		]);
	});

	it("archives not-loaded app-server threads without resuming them", async () => {
		await service.close();
		const runtime = new VolatileCodexRuntime();
		service = new ControlService(
			Store.open(join(tempDir, "volatile-archive.sqlite")),
			runtime,
		);
		service.seedLocalState({
			cwd: tempDir,
			runtimeName: runtime.name,
			cliVersion: runtime.version,
		});

		const result = await service.createThread({
			cwd: tempDir,
			prompt: "Archive after runtime disappears",
		});
		await waitForEvents();

		const threadId = result.thread?.id;
		if (!threadId) {
			throw new Error("Expected created thread id");
		}

		runtime.forgetThread(threadId);
		await expect(service.resumeThread(threadId)).rejects.toThrow(
			/is not loaded by Codex and could not be resumed/,
		);

		const archived = await service.archiveThread(threadId);
		if (!archived) {
			throw new Error("Expected archived thread");
		}
		const archivedPage = service.listThreadPage({
			archived: true,
			limit: 10,
		});

		expect(archived).toMatchObject({
			id: threadId,
			status: "not_loaded",
			activeTurnId: null,
			archivedAt: expect.any(String),
		});
		expect(service.listThreads()).toEqual([]);
		expect(archivedPage.totalCount).toBe(1);
		expect(archivedPage.threads).toMatchObject([
			{
				id: threadId,
				status: "not_loaded",
				archivedAt: archived.archivedAt,
			},
		]);
	});

	it("persists archive failures without returning the thread to active lists", async () => {
		await service.close();
		const runtime = new VolatileCodexRuntime();
		service = new ControlService(
			Store.open(join(tempDir, "failed-archive.sqlite")),
			runtime,
		);
		service.seedLocalState({ cwd: tempDir, runtimeName: runtime.name });
		const result = await service.createThread({
			cwd: tempDir,
			prompt: "Persist the failed archive intent",
		});
		await waitForEvents();
		const threadId = result.thread?.id;
		if (!threadId) throw new Error("Expected created thread id");
		runtime.failArchive(threadId);

		const thread = await service.archiveThread(threadId);

		expect(thread).toMatchObject({
			id: threadId,
			lifecycleState: "archive_failed",
			desiredArchived: true,
			lastOperationError: "archive rejected",
		});
		expect(service.listThreads()).toEqual([]);
		expect(service.store.listThreadOperations(threadId)).toMatchObject([
			{ kind: "archive", status: "failed", attempts: 1 },
		]);
	});

	it("keeps transient archive failures pending for recovery", async () => {
		await service.close();
		const runtime = new VolatileCodexRuntime();
		service = new ControlService(
			Store.open(join(tempDir, "pending-transient-archive.sqlite")),
			runtime,
		);
		service.seedLocalState({ cwd: tempDir, runtimeName: runtime.name });
		const result = await service.createThread({
			cwd: tempDir,
			prompt: "Retry this archive after reconnect",
		});
		await waitForEvents();
		const threadId = result.thread?.id;
		if (!threadId) throw new Error("Expected created thread id");
		runtime.failArchiveTransiently(threadId);

		const thread = await service.archiveThread(threadId);

		expect(thread).toMatchObject({
			lifecycleState: "archive_pending",
			desiredArchived: true,
			lastOperationError: null,
		});
		expect(service.store.listPendingThreadOperations()).toMatchObject([
			{ kind: "archive", status: "running", attempts: 1 },
		]);
	});

	it("unarchives through Codex and restores the canonical active thread", async () => {
		const result = await service.createThread({
			cwd: tempDir,
			prompt: "Archive then restore this thread",
		});
		await waitForEvents();
		const threadId = result.thread?.id;
		if (!threadId) throw new Error("Expected created thread id");
		await service.archiveThread(threadId);

		const restored = await service.unarchiveThread(threadId);

		expect(restored).toMatchObject({
			id: threadId,
			lifecycleState: "active",
			desiredArchived: false,
			remoteArchived: false,
			archivedAt: null,
		});
		expect(service.listThreads().map((thread) => thread.id)).toContain(
			threadId,
		);
	});

	it("does not apply a partial active and archived snapshot", async () => {
		await service.close();
		const runtime = new VolatileCodexRuntime();
		service = new ControlService(
			Store.open(join(tempDir, "partial-sync.sqlite")),
			runtime,
		);
		service.seedLocalState({ cwd: tempDir, runtimeName: runtime.name });
		const result = await service.createThread({
			cwd: tempDir,
			prompt: "Do not partially reconcile this thread",
		});
		await waitForEvents();
		const threadId = result.thread?.id;
		if (!threadId) throw new Error("Expected created thread id");
		runtime.archiveSilently(threadId);
		runtime.failArchivedList = true;

		await expect(service.syncThreads()).rejects.toThrow(
			"archived list unavailable",
		);

		expect(service.store.getThread(threadId)).toMatchObject({
			lifecycleState: "active",
			archivedAt: null,
		});
	});

	it("rejects snapshots that contain a thread on both lifecycle sides", async () => {
		await service.close();
		const runtime = new VolatileCodexRuntime();
		service = new ControlService(
			Store.open(join(tempDir, "overlapping-sync.sqlite")),
			runtime,
		);
		service.seedLocalState({ cwd: tempDir, runtimeName: runtime.name });
		const result = await service.createThread({
			cwd: tempDir,
			prompt: "Reject an inconsistent snapshot",
		});
		await waitForEvents();
		const threadId = result.thread?.id;
		if (!threadId) throw new Error("Expected created thread id");
		runtime.returnThreadOnBothLifecycleSides(threadId);

		await expect(service.syncThreads()).rejects.toThrow(
			/in both active and archived snapshots/,
		);
		expect(service.store.getThread(threadId)).toMatchObject({
			lifecycleState: "active",
			archivedAt: null,
		});
	});

	it("shares one active and archived snapshot across concurrent sync calls", async () => {
		await service.close();
		const runtime = new VolatileCodexRuntime();
		service = new ControlService(
			Store.open(join(tempDir, "single-flight-sync.sqlite")),
			runtime,
		);
		service.seedLocalState({ cwd: tempDir, runtimeName: runtime.name });

		const first = service.syncThreads();
		const second = service.syncThreads();
		await Promise.all([first, second]);

		expect(runtime.listThreadCalls).toBe(2);
		expect(
			service
				.replayEvents(0, { summaryOnly: true })
				.filter((event) => event.type === "threads.synced"),
		).toHaveLength(0);
	});

	it("recovers a durable pending archive during service startup", async () => {
		await service.close();
		const runtime = new VolatileCodexRuntime();
		service = new ControlService(
			Store.open(join(tempDir, "pending-operation.sqlite")),
			runtime,
		);
		service.seedLocalState({ cwd: tempDir, runtimeName: runtime.name });
		const result = await service.createThread({
			cwd: tempDir,
			prompt: "Recover this pending archive",
		});
		await waitForEvents();
		const threadId = result.thread?.id;
		if (!threadId) throw new Error("Expected created thread id");
		service.store.beginThreadOperation(threadId, "archive");

		await service.start();
		expect(service.store.getThread(threadId)).toMatchObject({
			lifecycleState: "archived",
			remoteArchived: true,
		});
		expect(service.store.listThreadOperations(threadId)).toMatchObject([
			{ kind: "archive", status: "succeeded", attempts: 1 },
		]);
	});

	it("forks from persisted history when the runtime thread is missing", async () => {
		await service.close();
		const runtime = new VolatileCodexRuntime();
		service = new ControlService(
			Store.open(join(tempDir, "volatile.sqlite")),
			runtime,
		);
		service.seedLocalState({
			cwd: tempDir,
			runtimeName: runtime.name,
			cliVersion: runtime.version,
		});

		const result = await service.createThread({
			cwd: tempDir,
			prompt: "Initial runtime thread",
		});
		await waitForEvents();

		const oldThreadId = result.thread?.id;
		if (!oldThreadId) {
			throw new Error("Expected created thread id");
		}

		runtime.forgetThread(oldThreadId);
		const turn = await service.startTurn({
			threadId: oldThreadId,
			prompt: "Prompt after app-server restart",
		});
		await waitForEvents();

		expect(turn.threadId).not.toBe(oldThreadId);
		expect(service.getThreadDetail(oldThreadId).status).toBe("not_loaded");
		expect(service.getThreadDetail(turn.threadId).forkedFromId).toBe(
			oldThreadId,
		);
	});

	it("marks a thread not loaded when resume succeeds but a non-forking action still loses runtime", async () => {
		await service.close();
		const runtime = new VolatileCodexRuntime();
		service = new ControlService(
			Store.open(join(tempDir, "volatile-lost.sqlite")),
			runtime,
		);
		service.seedLocalState({
			cwd: tempDir,
			runtimeName: runtime.name,
			cliVersion: runtime.version,
		});

		const result = await service.createThread({
			cwd: tempDir,
			prompt: "Initial runtime thread",
		});
		await waitForEvents();

		const threadId = result.thread?.id;
		if (!threadId) {
			throw new Error("Expected created thread id");
		}

		runtime.failSetGoal(threadId);
		await expect(
			service.setGoal({ threadId, objective: "Goal after runtime drift" }),
		).rejects.toThrow(/thread not found/);
		expect(service.getThreadDetail(threadId).status).toBe("not_loaded");
	});
});
