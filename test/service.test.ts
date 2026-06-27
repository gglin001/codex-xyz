import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	type CodexRuntime,
	type CompactThreadInput,
	type ForkThreadInput,
	type ResumeThreadInput,
	type RunShellCommandInput,
	type RuntimeBackgroundTerminal,
	type RuntimeEventHandler,
	type RuntimeFileSearchResult,
	type RuntimeGoalSnapshot,
	type RuntimeGoalStart,
	RuntimeThreadNotFoundError,
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

class VolatileCodexRuntime implements CodexRuntime {
	readonly name = "volatile";
	readonly version = "test";
	private handler: RuntimeEventHandler = () => {};
	private readonly loadedThreads = new Map<string, RuntimeThreadSnapshot>();
	private readonly persistedThreads = new Map<string, RuntimeThreadSnapshot>();
	private readonly missingGoalThreads = new Set<string>();
	private readonly timers = new Set<NodeJS.Timeout>();
	private nextThread = 1;
	private nextTurn = 1;

	onEvent(handler: RuntimeEventHandler) {
		this.handler = handler;
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
		this.requireThread(threadId);
		this.loadedThreads.delete(threadId);
		this.persistedThreads.delete(threadId);
		this.handler({
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

	async fuzzyFileSearch(): Promise<RuntimeFileSearchResult[]> {
		return [];
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

	async startThread(input: StartThreadInput): Promise<RuntimeThreadSnapshot> {
		const id = `eager_thread_${this.nextThread++}`;
		const thread: RuntimeThreadSnapshot = {
			id,
			sessionId: id,
			forkedFromId: null,
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

	async fuzzyFileSearch(): Promise<RuntimeFileSearchResult[]> {
		return [];
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

	async startThread(input: StartThreadInput): Promise<RuntimeThreadSnapshot> {
		const thread: RuntimeThreadSnapshot = {
			id: "drift_thread_1",
			sessionId: "drift_thread_1",
			forkedFromId: null,
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

	async fuzzyFileSearch(): Promise<RuntimeFileSearchResult[]> {
		return [];
	}

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

	it("passes structured composer input when creating and starting turns", async () => {
		const input = [
			{
				type: "text" as const,
				text: "Use this context",
				text_elements: [],
			},
			{
				type: "image" as const,
				url: "data:image/png;base64,abc",
				detail: "auto" as const,
			},
		];
		const result = await service.createThread({
			cwd: tempDir,
			prompt: "Review attachments",
			input,
		});
		expect(testRuntime.lastStartTurnInput?.input).toEqual(input);
		const threadId = result.thread?.id;
		if (!threadId) {
			throw new Error("Expected created thread id");
		}
		await waitForEvents();

		await service.startTurn({
			threadId,
			prompt: "Follow up",
			input,
		});

		expect(testRuntime.lastStartTurnInput?.input).toEqual(input);
		expect(testRuntime.lastStartTurnInput?.prompt).toBe("Follow up");
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

		const dashboard = service.dashboard();
		const detail = service.getThreadDetail(threadId);
		const fullReplay = service.replayEvents(0, { threadId });
		const summaryReplay = service.replayEvents(0, { summaryOnly: true });

		expect(dashboard.latestEventId).toBeGreaterThan(0);
		expect(dashboard.defaultCwd).toBe(tempDir);
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
		expect(service.dashboard().threads).toEqual([]);
		expect(
			summaryEvents.some((event) => event.type === "thread.archived"),
		).toBe(true);
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
