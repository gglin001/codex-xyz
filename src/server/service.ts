import { statSync } from "node:fs";
import { resolve } from "node:path";
import {
  type ControlThread,
  type CreateSessionInput,
  type DashboardState,
  type GoalStatus,
  nowIso,
  type RuntimeStatus,
  type SetGoalInput,
  type SetGoalStatusInput,
  type StartTurnInput,
  type ThreadDetail,
  type ThreadItem,
  type ThreadPage,
  titleFromPrompt,
  type Turn
} from "./domain.js";
import { EventBus } from "./eventBus.js";
import { Store } from "./store.js";
import {
  isAdapterThreadNotFoundError,
  type AdapterEvent,
  type AdapterGoal,
  type AdapterThread,
  type AdapterTurn,
  type CodexAdapter
} from "./codex/adapter.js";
import { TerminalController } from "./terminal.js";
import {
  RuntimeThreadCoordinator,
  type RuntimeContinuation,
  type RuntimeThreadActionOptions
} from "./runtimeThread.js";

function goalStatusFromAdapter(goal: AdapterGoal | null): GoalStatus | null {
  return goal ? goal.status : null;
}

function threadStatusFromTurnStatus(status: RuntimeStatus): RuntimeStatus {
  return status === "completed" ? "idle" : status;
}

function normalizeThreadRuntimeStatus(status: RuntimeStatus): RuntimeStatus {
  return status === "completed" ? "idle" : status;
}

function isNoActiveTurnError(error: unknown) {
  return error instanceof Error && /no active turn/i.test(error.message);
}

function normalizeWorkingDirectory(path: string) {
  const resolved = resolve(path.trim());
  let stat;
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

  constructor(
    readonly store: Store,
    readonly adapter: CodexAdapter,
    readonly events = new EventBus(),
    readonly terminal = new TerminalController()
  ) {
    this.runtimeThreads = new RuntimeThreadCoordinator({
      resumeThread: (thread) => this.resumeRuntimeThread(thread),
      markThreadLost: (thread) => this.markRuntimeThreadLost(thread),
      createContinuationThread: (thread, continuation) => this.createContinuationThread(thread, continuation),
      notResumableError: (thread) => new Error(`Thread ${thread.id} is not loaded by Codex and could not be resumed`)
    });
    this.adapter.onEvent((event) => this.handleAdapterEvent(event));
  }

  seedLocalState(input: { cwd: string; adapterName: string; cliVersion?: string | null }) {
    const cwd = normalizeWorkingDirectory(input.cwd);
    this.defaultCwd = cwd;
    this.terminal.configure({ cwd });
    this.store.upsertHost({
      id: "local",
      name: "Local host",
      adapter: input.adapterName,
      version: input.cliVersion ?? null,
      defaultCwd: cwd
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
      latestEventId
    };
  }

  async createSession(input: CreateSessionInput) {
    const cwd = normalizeWorkingDirectory(input.cwd);
    const title = input.title?.trim() || titleFromPrompt(input.prompt);
    const adapterThread = await this.adapter.startThread({
      cwd,
      promptPreview: titleFromPrompt(input.prompt),
      model: input.model ?? null
    });
    const thread = this.createThreadProjection({
      adapterThread,
      title,
      goalObjective: null,
      goalStatus: null,
      goalTokenBudget: null,
      preview: title,
      tokensUsed: 0
    });
    this.publish("thread.started", thread.id, null, { thread });

    if (input.goalMode) {
      const goalStart = await this.startGoal({
        threadId: thread.id,
        objective: input.prompt,
        tokenBudget: null
      });
      return {
        thread: goalStart.thread,
        turn: goalStart.turn,
        goal: goalStart.goal
      };
    }

    const turn = await this.startTurn({
      threadId: thread.id,
      prompt: input.prompt,
      model: input.model ?? null
    });
    return {
      thread: this.store.getThread(turn.threadId),
      turn,
      goal: null
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
        const current = this.clearLostActiveTurn(thread);
        const { adapterTurn, thread: runtimeThread } = await this.startRuntimeTurn(current, input);
        return this.recordTurn(runtimeThread, input.prompt, adapterTurn);
      }
      const activeTurn = this.store.getTurn(thread.activeTurnId);
      if (!activeTurn) {
        throw new Error(`Active turn ${thread.activeTurnId} does not exist`);
      }
      return activeTurn;
    }
    const { adapterTurn, thread: runtimeThread } = await this.startRuntimeTurn(thread, input);
    return this.recordTurn(runtimeThread, input.prompt, adapterTurn);
  }

  async interruptTurn(threadId: string) {
    const thread = this.requireThread(threadId);
    if (!thread.activeTurnId) {
      return thread;
    }
    const activeTurnId = await this.withRuntimeThread(thread, async (runtimeThread) => {
      if (!runtimeThread.activeTurnId) {
        return null;
      }
      await this.adapter.interruptTurn({ threadId: runtimeThread.id, turnId: runtimeThread.activeTurnId });
      return runtimeThread.activeTurnId;
    });
    if (activeTurnId) {
      this.publish("turn.interrupt.requested", threadId, activeTurnId, {});
    }
    return this.store.getThread(threadId);
  }

  async resumeThread(threadId: string) {
    const thread = this.requireThread(threadId);
    const resumed = await this.resumeRuntimeThread(thread);
    if (!resumed) {
      this.markRuntimeThreadLost(thread);
      throw new Error(`Thread ${thread.id} is not loaded by Codex and could not be resumed`);
    }
    return this.store.getThread(threadId);
  }

  async setGoal(input: SetGoalInput) {
    const source = this.requireThread(input.threadId);
    const goal = await this.withRuntimeThread(source, (runtimeThread) =>
      this.adapter.setGoal({
        threadId: runtimeThread.id,
        objective: input.objective,
        tokenBudget: input.tokenBudget
      })
    );
    this.updateGoalProjection(input.threadId, goal, null);
    return goal;
  }

  async setGoalStatus(input: SetGoalStatusInput) {
    const source = this.requireThread(input.threadId);
    const goal = await this.withRuntimeThread(source, (runtimeThread) =>
      this.adapter.setGoalStatus({
        threadId: runtimeThread.id,
        status: input.status
      })
    );
    const thread = this.updateGoalProjection(input.threadId, goal, null);
    return { goal, thread };
  }

  async startGoal(input: SetGoalInput) {
    const source = this.requireThread(input.threadId);
    if (source.activeTurnId || source.status !== "idle") {
      throw new Error("Goal mode requires an idle thread");
    }
    const { goal, turn: adapterTurn } = await this.withRuntimeThread(source, (runtimeThread) =>
      this.adapter.startGoal({
        threadId: runtimeThread.id,
        objective: input.objective,
        tokenBudget: input.tokenBudget
      })
    );
    const thread = this.updateGoalProjection(input.threadId, goal, null);
    if (!thread) {
      throw new Error(`Thread ${input.threadId} does not exist`);
    }
    const turn = this.recordTurn(thread, "", adapterTurn);
    return {
      goal,
      turn,
      thread: this.store.getThread(turn.threadId)
    };
  }

  async getGoal(threadId: string) {
    const source = this.requireThread(threadId);
    return this.withRuntimeThread(source, (runtimeThread) => this.adapter.getGoal(runtimeThread.id));
  }

  async clearGoal(threadId: string) {
    const source = this.requireThread(threadId);
    await this.withRuntimeThread(source, (runtimeThread) => this.adapter.clearGoal(runtimeThread.id));
    return this.updateGoalProjection(threadId, null, null, { clearedStatus: "cleared" });
  }

  listThreads() {
    return this.store.listThreads();
  }

  listThreadPage(input: { limit?: number | null; offset?: number | null } = {}): ThreadPage {
    const totalCount = this.store.countThreads();
    const limit = normalizePageLimit(input.limit);
    const offset = normalizePageOffset(input.offset);
    const threads = this.store.listThreads({ limit, offset });
    const nextOffset = offset + threads.length;
    return {
      threads,
      totalCount,
      offset,
      limit,
      nextOffset,
      hasMore: nextOffset < totalCount
    };
  }

  getThreadDetail(threadId: string): ThreadDetail {
    const detail = this.store.getThreadDetail(threadId);
    if (!detail) {
      throw new Error(`Thread ${threadId} does not exist`);
    }
    return detail;
  }

  replayEvents(afterId = 0, options: { threadId?: string | null; summaryOnly?: boolean } = {}) {
    return this.store.listEvents(afterId, options);
  }

  async close() {
    await this.terminal.close();
    await this.adapter.close();
    this.store.close();
  }

  private handleAdapterEvent(event: AdapterEvent) {
    if (event.type === "item.created" || event.type === "item.updated") {
      if (!this.ensureTurnForEvent(event.threadId, event.turnId)) {
        return;
      }
      const item: ThreadItem = {
        id: event.itemId,
        threadId: event.threadId,
        turnId: event.turnId,
        type: event.itemType,
        text: event.text,
        data: event.data ?? {},
        createdAt: nowIso()
      };
      const stored = this.store.upsertItem(item) ?? item;
      this.publish(event.type, event.threadId, event.turnId, { item: stored });
      return;
    }

    if (event.type === "item.delta") {
      let item = this.store.appendItemText(event.itemId, event.delta);
      if (!item) {
        if (!this.ensureTurnForEvent(event.threadId, event.turnId)) {
          return;
        }
        item = this.store.createItem({
          id: event.itemId,
          threadId: event.threadId,
          turnId: event.turnId,
          type: event.itemType ?? "agent",
          text: event.delta,
          data: { synthesized: true },
          createdAt: nowIso()
        });
      }
      this.publish("item.delta", event.threadId, event.turnId, {
        itemId: event.itemId,
        delta: event.delta,
        item
      });
      return;
    }

    if (event.type === "turn.status") {
      if (!this.ensureTurnForEvent(event.threadId, event.turnId)) {
        return;
      }
      const completedAt = event.status === "running" ? null : nowIso();
      this.store.updateTurn(event.turnId, {
        status: event.status,
        completedAt,
        durationMs: event.durationMs ?? null
      });
      this.store.updateThread(event.threadId, {
        status: threadStatusFromTurnStatus(event.status),
        activeTurnId: event.status === "running" ? event.turnId : null
      });
      this.publish("turn.status", event.threadId, event.turnId, { status: event.status });
      return;
    }

    if (event.type === "turn.started") {
      const thread = this.store.getThread(event.threadId);
      if (!thread) {
        return;
      }
      this.recordTurn(thread, event.prompt ?? "", {
        id: event.turnId,
        status: "running"
      });
      return;
    }

    if (event.type === "thread.status") {
      const updates: Partial<Pick<ControlThread, "status" | "activeTurnId">> = {
        status: event.status
      };
      if (event.status !== "running") {
        updates.activeTurnId = null;
      }
      const thread = this.store.updateThread(event.threadId, updates);
      this.publish("thread.status", event.threadId, null, { status: event.status, thread });
      return;
    }

    if (event.type === "thread.goal") {
      this.updateGoalProjection(event.threadId, event.goal, event.turnId);
      return;
    }

    if (event.type === "thread.renamed") {
      const title = event.title?.trim();
      if (title) {
        const thread = this.store.updateThread(event.threadId, { title });
        this.publish("thread.renamed", event.threadId, null, { title, thread });
      }
      return;
    }

    if (event.type === "thread.token_usage") {
      const thread = this.store.updateThread(event.threadId, {
        tokensUsed: event.usage.totalTokens
      });
      this.publish("thread.token_usage", event.threadId, event.turnId, {
        usage: event.usage,
        thread
      });
      return;
    }

    if (event.type === "raw") {
      this.publish("adapter.raw", event.threadId ?? null, event.turnId ?? null, {
        method: event.method,
        payload: event.payload
      });
    }
  }

  private publish(type: string, threadId: string | null, turnId: string | null, payload: Record<string, unknown>) {
    const event = this.store.appendEvent({
      type,
      threadId,
      turnId,
      payload,
      createdAt: nowIso()
    });
    this.events.publish(event);
    return event;
  }

  private updateGoalProjection(
    threadId: string,
    goal: AdapterGoal | null,
    turnId: string | null,
    options: { clearedStatus?: GoalStatus | null } = {}
  ) {
    const existing = this.store.getThread(threadId);
    const thread = this.store.updateThread(threadId, {
      goalObjective: goal?.objective ?? null,
      goalStatus: goal ? goalStatusFromAdapter(goal) : (options.clearedStatus ?? null),
      goalTokenBudget: goal?.tokenBudget ?? null,
      tokensUsed: goal?.tokensUsed ?? existing?.tokensUsed ?? 0
    });
    this.publish(goal ? "thread.goal.updated" : "thread.goal.cleared", threadId, turnId, { goal, thread });
    return thread;
  }

  private ensureTurnForEvent(threadId: string, turnId: string | null, prompt = "") {
    const thread = this.store.getThread(threadId);
    if (!thread) {
      return false;
    }
    if (!turnId) {
      return true;
    }
    const existing = this.store.getTurn(turnId);
    if (existing) {
      return true;
    }
    const now = nowIso();
    const turn: Turn = {
      id: turnId,
      threadId,
      status: "running",
      prompt,
      startedAt: now,
      completedAt: null,
      durationMs: null
    };
    this.store.createTurn(turn);
    this.store.updateThread(threadId, {
      status: "running",
      activeTurnId: turnId,
      preview: prompt || thread.preview
    });
    this.publish("turn.started", threadId, turnId, { turn });
    return true;
  }

  private createThreadProjection(input: {
    adapterThread: AdapterThread;
    title: string;
    forkedFromId?: string | null;
    goalObjective: string | null;
    goalStatus: GoalStatus | null;
    goalTokenBudget?: number | null;
    preview?: string;
    tokensUsed: number;
  }) {
    const now = input.adapterThread.updatedAt ?? nowIso();
    const status = normalizeThreadRuntimeStatus(input.adapterThread.status);
    const thread: ControlThread = {
      id: input.adapterThread.id,
      sessionId: input.adapterThread.sessionId,
      forkedFromId: input.forkedFromId ?? input.adapterThread.forkedFromId,
      title: input.title,
      preview: input.adapterThread.preview || input.preview || input.title,
      cwd: input.adapterThread.cwd,
      model: input.adapterThread.model,
      status,
      activeTurnId: status === "running" ? (input.adapterThread.activeTurnId ?? null) : null,
      goalObjective: input.goalObjective,
      goalStatus: input.goalStatus,
      goalTokenBudget: input.goalTokenBudget ?? null,
      tokensUsed: input.tokensUsed,
      createdAt: now,
      updatedAt: now
    };
    this.store.createThread(thread);
    return thread;
  }

  private recordTurn(thread: ControlThread, prompt: string, adapterTurn: AdapterTurn) {
    const existing = this.store.getTurn(adapterTurn.id);
    if (existing) {
      const current = !existing.prompt && prompt ? this.store.updateTurn(existing.id, { prompt }) ?? existing : existing;
      this.store.updateThread(thread.id, {
        status: threadStatusFromTurnStatus(current.status),
        activeTurnId: current.status === "running" ? current.id : null,
        preview: current.prompt || prompt || thread.preview
      });
      return current;
    }

    const now = nowIso();
    const turn: Turn = {
      id: adapterTurn.id,
      threadId: thread.id,
      status: "running",
      prompt,
      startedAt: now,
      completedAt: null,
      durationMs: null
    };
    this.store.createTurn(turn);
    this.store.updateThread(thread.id, {
      status: "running",
      activeTurnId: turn.id,
      preview: prompt || thread.preview
    });
    this.publish("turn.started", thread.id, turn.id, { turn });
    return turn;
  }

  private async startShellCommand(thread: ControlThread, prompt: string, command: string) {
    const { adapterTurn, thread: runtimeThread } = await this.startRuntimeShellCommand(thread, command);
    return this.recordTurn(runtimeThread, prompt, adapterTurn);
  }

  private async steerActiveTurn(thread: ControlThread, prompt: string) {
    if (!thread.activeTurnId) {
      throw new Error("Thread has no active turn to steer");
    }
    const activeTurnId = await this.withRuntimeThread(thread, async (runtimeThread) => {
      if (!runtimeThread.activeTurnId) {
        throw new Error("Thread has no active turn to steer");
      }
      await this.adapter.steerTurn({
        threadId: runtimeThread.id,
        turnId: runtimeThread.activeTurnId,
        prompt
      });
      return runtimeThread.activeTurnId;
    });
    this.publish("turn.steered", thread.id, activeTurnId, { prompt });
  }

  private async startRuntimeTurn(thread: ControlThread, input: StartTurnInput) {
    const result = await this.runRuntimeAction(
      thread,
      (runtimeThread) =>
        this.adapter.startTurn({
          threadId: runtimeThread.id,
          prompt: input.prompt,
          model: input.model ?? runtimeThread.model
        }),
      {
        continuation: {
          prompt: input.prompt,
          model: input.model ?? thread.model
        }
      }
    );
    return {
      thread: result.thread,
      adapterTurn: result.value
    };
  }

  private async startRuntimeShellCommand(thread: ControlThread, command: string) {
    const result = await this.runRuntimeAction(
      thread,
      (runtimeThread) =>
        this.adapter.runShellCommand({
          threadId: runtimeThread.id,
          command,
          activeTurnId: runtimeThread.id === thread.id ? runtimeThread.activeTurnId : null
        }),
      {
        continuation: {
          prompt: `!${command}`,
          model: thread.model
        }
      }
    );
    return {
      thread: result.thread,
      adapterTurn: result.value
    };
  }

  private async withRuntimeThread<T>(thread: ControlThread, action: (thread: ControlThread) => Promise<T>) {
    return (await this.runtimeThreads.run(thread, action)).value;
  }

  private async runRuntimeAction<T>(
    thread: ControlThread,
    action: (thread: ControlThread) => Promise<T>,
    options: RuntimeThreadActionOptions = {}
  ): Promise<{ thread: ControlThread; value: T }> {
    return this.runtimeThreads.run(thread, action, options);
  }

  private async resumeRuntimeThread(thread: ControlThread) {
    try {
      const adapterThread = await this.adapter.resumeThread({
        threadId: thread.id,
        cwd: thread.cwd,
        model: thread.model
      });
      this.applyRuntimeThreadSnapshot(thread, adapterThread);
      this.publish("thread.resumed", thread.id, null, { thread: this.store.getThread(thread.id) });
      return this.store.getThread(thread.id) ?? thread;
    } catch (error) {
      if (isAdapterThreadNotFoundError(error)) {
        return null;
      }
      throw error;
    }
  }

  private applyRuntimeThreadSnapshot(thread: ControlThread, adapterThread: AdapterThread) {
    const runtimeStatus = normalizeThreadRuntimeStatus(adapterThread.status);
    const nextActiveTurnId =
      runtimeStatus === "running" ? (adapterThread.activeTurnId ?? thread.activeTurnId ?? null) : null;
    const updates: Partial<Pick<ControlThread, "status" | "activeTurnId" | "preview">> = {
      status: runtimeStatus,
      activeTurnId: nextActiveTurnId,
      preview: adapterThread.preview || thread.preview
    };
    const fieldsChanged =
      thread.status !== updates.status ||
      thread.activeTurnId !== updates.activeTurnId ||
      thread.preview !== updates.preview;
    const updatedAtChanged = Boolean(adapterThread.updatedAt && adapterThread.updatedAt !== thread.updatedAt);
    const changed = fieldsChanged || updatedAtChanged;

    if (runtimeStatus !== "running" && thread.activeTurnId) {
      const activeTurn = this.store.getTurn(thread.activeTurnId);
      if (activeTurn?.status === "running") {
        this.store.updateTurn(activeTurn.id, {
          status: "interrupted",
          completedAt: nowIso(),
          durationMs: null
        });
      }
    }

    const updated = changed
      ? this.store.updateThread(
          thread.id,
          updates,
          adapterThread.updatedAt ? { updatedAt: adapterThread.updatedAt } : { preserveUpdatedAt: true }
        )
      : thread;
    if (fieldsChanged) {
      this.publish("thread.status", thread.id, null, { status: runtimeStatus, thread: updated });
    }

    return {
      thread: updated,
      updated: changed
    };
  }

  private clearLostActiveTurn(thread: ControlThread) {
    if (thread.activeTurnId) {
      const activeTurn = this.store.getTurn(thread.activeTurnId);
      if (activeTurn?.status === "running") {
        this.store.updateTurn(activeTurn.id, {
          status: "interrupted",
          completedAt: nowIso(),
          durationMs: null
        });
      }
    }
    const updated = this.store.updateThread(thread.id, {
      status: "idle",
      activeTurnId: null
    });
    this.publish("thread.status", thread.id, null, { status: "idle", thread: updated });
    return updated ?? this.requireThread(thread.id);
  }

  private async createContinuationThread(source: ControlThread, continuation: RuntimeContinuation) {
    this.markRuntimeThreadLost(source);
    const adapterThread = await this.adapter.startThread({
      cwd: source.cwd,
      promptPreview: titleFromPrompt(continuation.prompt),
      model: continuation.model
    });
    const thread = this.createThreadProjection({
      adapterThread,
      title: source.title,
      forkedFromId: source.id,
      goalObjective: source.goalObjective,
      goalStatus: source.goalStatus,
      goalTokenBudget: source.goalTokenBudget,
      preview: continuation.prompt,
      tokensUsed: source.tokensUsed
    });
    this.publish("thread.continued", thread.id, null, { thread, sourceThreadId: source.id });
    return thread;
  }

  private markRuntimeThreadLost(thread: ControlThread) {
    const activeTurn = thread.activeTurnId ? this.store.getTurn(thread.activeTurnId) : null;
    if (activeTurn) {
      this.store.updateTurn(activeTurn.id, {
        status: "interrupted",
        completedAt: nowIso(),
        durationMs: null
      });
    }
    const updated = this.store.updateThread(thread.id, {
      status: "stale",
      activeTurnId: null
    });
    this.publish("thread.runtime_lost", thread.id, null, { thread: updated });
  }

  private requireThread(threadId: string): ControlThread {
    const thread = this.store.getThread(threadId);
    if (!thread) {
      throw new Error(`Thread ${threadId} does not exist`);
    }
    return thread;
  }
}
