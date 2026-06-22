import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	type AdapterEventHandler,
	type AdapterGoal,
	type AdapterGoalStart,
	type AdapterThread,
	AdapterThreadNotFoundError,
	type AdapterTurn,
	type CodexAdapter,
	type ForkThreadInput,
	type ResumeThreadInput,
	type RunShellCommandInput,
	type StartThreadInput,
	type StartTurnAdapterInput,
} from "../src/server/codex/adapter.js";
import { ControlService } from "../src/server/service.js";
import { Store } from "../src/server/store.js";
import { TestCodexAdapter } from "./testCodexAdapter.js";

let tempDir: string;
let service: ControlService;
let testAdapter: TestCodexAdapter;

async function waitForEvents() {
	await new Promise((resolve) => setTimeout(resolve, 20));
}

class VolatileCodexAdapter implements CodexAdapter {
	readonly name = "volatile";
	readonly version = "test";
	private handler: AdapterEventHandler = () => {};
	private readonly threads = new Map<string, AdapterThread>();
	private readonly missingGoalThreads = new Set<string>();
	private readonly timers = new Set<NodeJS.Timeout>();
	private nextThread = 1;
	private nextTurn = 1;

	onEvent(handler: AdapterEventHandler) {
		this.handler = handler;
	}

	forgetThread(threadId: string) {
		this.threads.delete(threadId);
	}

	failSetGoal(threadId: string) {
		this.missingGoalThreads.add(threadId);
	}

	async startThread(input: StartThreadInput): Promise<AdapterThread> {
		const id = `volatile_thread_${this.nextThread++}`;
		const thread: AdapterThread = {
			id,
			sessionId: id,
			forkedFromId: null,
			preview: input.promptPreview,
			cwd: input.cwd,
			model: input.model ?? "volatile-model",
			status: "idle",
		};
		this.threads.set(id, thread);
		return thread;
	}

	async resumeThread(input: ResumeThreadInput): Promise<AdapterThread> {
		return this.requireThread(input.threadId);
	}

	async startTurn(input: StartTurnAdapterInput): Promise<AdapterTurn> {
		this.requireThread(input.threadId);
		const turn: AdapterTurn = {
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

	async runShellCommand(input: RunShellCommandInput): Promise<AdapterTurn> {
		return this.startTurn({
			threadId: input.threadId,
			prompt: `!${input.command}`,
		});
	}

	async steerTurn(input: { threadId: string }) {
		this.requireThread(input.threadId);
	}

	async interruptTurn(input: { threadId: string }) {
		this.requireThread(input.threadId);
	}

	async forkThread(input: ForkThreadInput): Promise<AdapterThread> {
		const source = this.requireThread(input.sourceThreadId);
		const fork = await this.startThread({
			cwd: input.cwd,
			model: input.model ?? source.model,
			promptPreview: `Fork of ${source.preview}`,
		});
		return {
			...fork,
			sessionId: source.sessionId,
			forkedFromId: source.id,
		};
	}

	async renameThread(input: { threadId: string }) {
		this.requireThread(input.threadId);
	}

	async setGoal(input: {
		threadId: string;
		objective: string;
		tokenBudget?: number | null;
	}): Promise<AdapterGoal> {
		this.requireThread(input.threadId);
		if (this.missingGoalThreads.has(input.threadId)) {
			throw new AdapterThreadNotFoundError(
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
	}): Promise<AdapterGoal> {
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
	}): Promise<AdapterGoalStart> {
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

	async close() {
		for (const timer of this.timers) {
			clearTimeout(timer);
		}
		this.timers.clear();
	}

	private requireThread(threadId: string) {
		const thread = this.threads.get(threadId);
		if (!thread) {
			throw new AdapterThreadNotFoundError(
				threadId,
				`thread not found: ${threadId}`,
			);
		}
		return thread;
	}
}

class EagerEventCodexAdapter implements CodexAdapter {
	readonly name = "eager";
	readonly version = "test";
	private handler: AdapterEventHandler = () => {};
	private readonly threads = new Map<string, AdapterThread>();
	private nextThread = 1;
	private nextTurn = 1;

	onEvent(handler: AdapterEventHandler) {
		this.handler = handler;
	}

	async startThread(input: StartThreadInput): Promise<AdapterThread> {
		const id = `eager_thread_${this.nextThread++}`;
		const thread: AdapterThread = {
			id,
			sessionId: id,
			forkedFromId: null,
			preview: input.promptPreview,
			cwd: input.cwd,
			model: input.model ?? "eager-model",
			status: "idle",
		};
		this.threads.set(id, thread);
		return thread;
	}

	async resumeThread(input: ResumeThreadInput): Promise<AdapterThread> {
		return this.requireThread(input.threadId);
	}

	async startTurn(input: StartTurnAdapterInput): Promise<AdapterTurn> {
		this.requireThread(input.threadId);
		const turn: AdapterTurn = {
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
			data: { adapter: "eager" },
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

	async runShellCommand(input: RunShellCommandInput): Promise<AdapterTurn> {
		return this.startTurn({
			threadId: input.threadId,
			prompt: `!${input.command}`,
			model: null,
		});
	}

	async steerTurn(input: { threadId: string }) {
		this.requireThread(input.threadId);
	}

	async interruptTurn(input: { threadId: string }) {
		this.requireThread(input.threadId);
	}

	async forkThread(input: ForkThreadInput): Promise<AdapterThread> {
		const source = this.requireThread(input.sourceThreadId);
		const id = `eager_thread_${this.nextThread++}`;
		const thread: AdapterThread = {
			id,
			sessionId: source.sessionId,
			forkedFromId: source.id,
			preview: `Fork of ${source.preview}`,
			cwd: input.cwd,
			model: input.model ?? source.model,
			status: "idle",
		};
		this.threads.set(id, thread);
		return thread;
	}

	async renameThread(input: { threadId: string }) {
		this.requireThread(input.threadId);
	}

	async setGoal(input: {
		threadId: string;
		objective: string;
		tokenBudget?: number | null;
	}): Promise<AdapterGoal> {
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
	}): Promise<AdapterGoal> {
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
	}): Promise<AdapterGoalStart> {
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

	async close() {
		this.threads.clear();
	}

	private requireThread(threadId: string) {
		const thread = this.threads.get(threadId);
		if (!thread) {
			throw new AdapterThreadNotFoundError(
				threadId,
				`thread not found: ${threadId}`,
			);
		}
		return thread;
	}
}

class InterruptDriftCodexAdapter implements CodexAdapter {
	readonly name = "interrupt-drift";
	readonly version = "test";
	handler: AdapterEventHandler = () => {};
	private thread: AdapterThread | null = null;
	private readonly activeTurnId = "drift_turn_1";

	onEvent(handler: AdapterEventHandler) {
		this.handler = handler;
	}

	async startThread(input: StartThreadInput): Promise<AdapterThread> {
		const thread: AdapterThread = {
			id: "drift_thread_1",
			sessionId: "drift_thread_1",
			forkedFromId: null,
			preview: input.promptPreview,
			cwd: input.cwd,
			model: input.model ?? "drift-model",
			status: "idle",
		};
		this.thread = thread;
		return thread;
	}

	async resumeThread(input: ResumeThreadInput): Promise<AdapterThread> {
		if (!this.thread || this.thread.id !== input.threadId) {
			throw new AdapterThreadNotFoundError(
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

	async startTurn(input: StartTurnAdapterInput): Promise<AdapterTurn> {
		if (!this.thread || this.thread.id !== input.threadId) {
			throw new AdapterThreadNotFoundError(
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

	async runShellCommand(input: RunShellCommandInput): Promise<AdapterTurn> {
		return this.startTurn({
			threadId: input.threadId,
			prompt: `!${input.command}`,
			model: null,
		});
	}

	async steerTurn() {}

	async interruptTurn(input: { threadId: string }) {
		throw new AdapterThreadNotFoundError(
			input.threadId,
			`no rollout found for thread id ${input.threadId}`,
		);
	}

	async forkThread(input: ForkThreadInput): Promise<AdapterThread> {
		return this.startThread({
			cwd: input.cwd,
			model: input.model,
			promptPreview: "fork",
		});
	}

	async renameThread() {}

	async setGoal(input: {
		objective: string;
		tokenBudget?: number | null;
	}): Promise<AdapterGoal> {
		return {
			objective: input.objective,
			status: "in_progress",
			tokenBudget: input.tokenBudget ?? null,
			tokensUsed: 0,
		};
	}

	async setGoalStatus(input: {
		status: "active" | "paused" | "complete";
	}): Promise<AdapterGoal> {
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
	}): Promise<AdapterGoalStart> {
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

	async close() {
		this.thread = null;
		this.handler = () => {};
	}
}

beforeEach(() => {
	tempDir = mkdtempSync(join(tmpdir(), "coz-service-"));
	testAdapter = new TestCodexAdapter();
	service = new ControlService(
		Store.open(join(tempDir, "test.sqlite")),
		testAdapter,
	);
	service.seedLocalState({
		cwd: tempDir,
		adapterName: "test",
		cliVersion: "test",
	});
});

afterEach(async () => {
	await service.close();
	rmSync(tempDir, { recursive: true, force: true });
});

describe("ControlService", () => {
	it("creates a session, starts a turn, records transcript items, and completes", async () => {
		const result = await service.createSession({
			cwd: tempDir,
			prompt: "Implement local test support",
		});
		expect(result.thread?.status).toBe("active");

		await waitForEvents();

		const threads = service.listThreads();
		expect(threads).toHaveLength(1);
		expect(threads[0].status).toBe("idle");

		const detail = service.getThreadDetail(threads[0].id);
		expect(detail.turns).toHaveLength(1);
		expect(detail.turns[0].status).toBe("completed");
		expect(
			detail.items.some(
				(item) =>
					item.type === "agent" && item.text.includes("Test run started"),
			),
		).toBe(true);
	});

	it("creates a goal session and starts the first goal turn", async () => {
		const result = await service.createSession({
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
		const result = await service.createSession({
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
		expect(summaryReplay.some((event) => event.type.startsWith("item."))).toBe(
			false,
		);
		expect(summaryReplay.some((event) => event.type === "adapter.raw")).toBe(
			false,
		);
	});

	it("records items that arrive before the adapter startTurn call returns", async () => {
		await service.close();
		const adapter = new EagerEventCodexAdapter();
		service = new ControlService(
			Store.open(join(tempDir, "eager.sqlite")),
			adapter,
		);
		service.seedLocalState({
			cwd: tempDir,
			adapterName: adapter.name,
			cliVersion: adapter.version,
		});

		const result = await service.createSession({
			cwd: tempDir,
			prompt: "Prompt with eager adapter events",
		});
		const threadId = result.thread?.id;
		if (!threadId || !result.turn) {
			throw new Error("Expected created thread and turn");
		}

		const detail = service.getThreadDetail(threadId);
		expect(result.turn.status).toBe("completed");
		expect(detail.status).toBe("idle");
		expect(detail.turns).toHaveLength(1);
		expect(detail.turns[0].prompt).toBe("Prompt with eager adapter events");
		expect(detail.turns[0].status).toBe("completed");
		expect(
			detail.items.some((item) => item.text.includes("Answered before return")),
		).toBe(true);
	});

	it("runs bang-prefixed prompts as app-server shell commands", async () => {
		const result = await service.createSession({
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

	it("steers the active turn for default submissions while a session is running", async () => {
		const result = await service.createSession({
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
		const result = await service.createSession({
			cwd: tempDir,
			prompt: "Keep this turn open for steering approval",
		});
		await waitForEvents();

		const threadId = result.thread?.id;
		if (!threadId || !result.turn) {
			throw new Error("Expected created running thread and turn");
		}

		testAdapter.dropActiveTurn(threadId);
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
		const adapter = new InterruptDriftCodexAdapter();
		service = new ControlService(
			Store.open(join(tempDir, "interrupt-drift.sqlite")),
			adapter,
		);
		service.seedLocalState({
			cwd: tempDir,
			adapterName: adapter.name,
			cliVersion: adapter.version,
		});

		const result = await service.createSession({
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

	it("supports the core goal controls on an existing idle session", async () => {
		const result = await service.createSession({
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

	it("continues on a new thread when the persisted runtime thread is missing", async () => {
		await service.close();
		const adapter = new VolatileCodexAdapter();
		service = new ControlService(
			Store.open(join(tempDir, "volatile.sqlite")),
			adapter,
		);
		service.seedLocalState({
			cwd: tempDir,
			adapterName: adapter.name,
			cliVersion: adapter.version,
		});

		const result = await service.createSession({
			cwd: tempDir,
			prompt: "Initial runtime thread",
		});
		await waitForEvents();

		const oldThreadId = result.thread?.id;
		if (!oldThreadId) {
			throw new Error("Expected created thread id");
		}

		adapter.forgetThread(oldThreadId);
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

	it("marks a thread not loaded when resume succeeds but a non-continuation action still loses runtime", async () => {
		await service.close();
		const adapter = new VolatileCodexAdapter();
		service = new ControlService(
			Store.open(join(tempDir, "volatile-lost.sqlite")),
			adapter,
		);
		service.seedLocalState({
			cwd: tempDir,
			adapterName: adapter.name,
			cliVersion: adapter.version,
		});

		const result = await service.createSession({
			cwd: tempDir,
			prompt: "Initial runtime thread",
		});
		await waitForEvents();

		const threadId = result.thread?.id;
		if (!threadId) {
			throw new Error("Expected created thread id");
		}

		adapter.failSetGoal(threadId);
		await expect(
			service.setGoal({ threadId, objective: "Goal after runtime drift" }),
		).rejects.toThrow(/thread not found/);
		expect(service.getThreadDetail(threadId).status).toBe("not_loaded");
	});
});
