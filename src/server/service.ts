import { statSync } from "node:fs";
import { basename, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import {
  type ControlThread,
  type CreateTaskInput,
  type DashboardState,
  type GoalStatus,
  nowIso,
  type Project,
  type RuntimeStatus,
  type StartTurnInput,
  type Task,
  type ThreadDetail,
  type ThreadItem,
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

function taskStatusFromRuntime(status: RuntimeStatus): Task["status"] {
  if (status === "completed" || status === "idle") {
    return "completed";
  }
  if (status === "failed" || status === "stale") {
    return "failed";
  }
  if (status === "interrupted") {
    return "interrupted";
  }
  return "running";
}

function goalStatusFromAdapter(goal: AdapterGoal | null): GoalStatus | null {
  return goal ? goal.status : null;
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

function projectNameFromPath(path: string, name?: string | null) {
  return name?.trim() || basename(path) || path;
}

export class ControlService {
  constructor(
    readonly store: Store,
    readonly adapter: CodexAdapter,
    readonly events = new EventBus()
  ) {
    this.adapter.onEvent((event) => this.handleAdapterEvent(event));
  }

  seedLocalState(input: { cwd: string; adapterName: string; cliVersion?: string | null }) {
    const cwd = normalizeWorkingDirectory(input.cwd);
    this.store.upsertHost({
      id: "local",
      name: "Local host",
      adapter: input.adapterName,
      version: input.cliVersion ?? null
    });
    const existing = this.store.getProjectByPath(cwd);
    if (!existing) {
      this.store.createProject({
        id: "local",
        name: projectNameFromPath(cwd),
        path: cwd,
        tags: ["local"]
      });
    }
    this.seedRecipes();
  }

  dashboard(): DashboardState {
    return {
      projects: this.store.listProjects(),
      tasks: this.store.listTasks(),
      threads: this.store.listThreads(),
      recipes: this.store.listRecipes()
    };
  }

  listProjects() {
    return this.store.listProjects();
  }

  createProject(input: { name?: string | null; path: string; tags?: string[] }) {
    const path = normalizeWorkingDirectory(input.path);
    const project = this.store.createProject({
      id: randomUUID(),
      name: projectNameFromPath(path, input.name),
      path,
      tags: input.tags ?? []
    });
    if (!project) {
      throw new Error(`Failed to create project for ${path}`);
    }
    this.publish("project.upserted", null, null, { project });
    return project;
  }

  listTasks() {
    return this.store.listTasks();
  }

  async createTask(input: CreateTaskInput) {
    const project = this.requireProject(input.projectId);
    const now = nowIso();
    const task: Task = {
      id: randomUUID(),
      projectId: project.id,
      threadId: null,
      title: input.title?.trim() || titleFromPrompt(input.prompt),
      prompt: input.prompt,
      recipeId: input.recipeId ?? null,
      status: "queued",
      createdAt: now,
      updatedAt: now
    };
    this.store.createTask(task);
    this.publish("task.created", null, null, { task });

    const adapterThread = await this.adapter.startThread({
      cwd: project.path,
      promptPreview: titleFromPrompt(input.prompt),
      model: input.model ?? null
    });
    const thread = this.createThreadProjection({
      adapterThread,
      projectId: project.id,
      title: task.title,
      goalObjective: null,
      goalStatus: null,
      preview: task.title,
      tokensUsed: 0
    });
    this.store.updateTask(task.id, { threadId: thread.id, status: "running" });
    this.publish("thread.started", thread.id, null, { thread });

    const turn = await this.startTurn({
      threadId: thread.id,
      prompt: input.prompt,
      model: input.model ?? null
    });
    if (turn.threadId !== thread.id) {
      this.store.updateTask(task.id, { threadId: turn.threadId, status: "running" });
    }
    return {
      task: this.store.getTask(task.id),
      thread: this.store.getThread(turn.threadId),
      turn
    };
  }

  async startTurn(input: StartTurnInput) {
    const thread = this.requireThread(input.threadId);
    const { adapterTurn, thread: runtimeThread } = await this.startRuntimeTurn(thread, input);
    return this.recordTurn(runtimeThread, input.prompt, adapterTurn);
  }

  async steerTurn(threadId: string, prompt: string) {
    const thread = this.requireThread(threadId);
    if (!thread.activeTurnId) {
      throw new Error("Thread has no active turn to steer");
    }
    await this.withRuntimeThread(thread, () =>
      this.adapter.steerTurn({
        threadId,
        turnId: thread.activeTurnId as string,
        prompt
      })
    );
    this.publish("turn.steered", threadId, thread.activeTurnId, { prompt });
  }

  async interruptTurn(threadId: string) {
    const thread = this.requireThread(threadId);
    if (!thread.activeTurnId) {
      return thread;
    }
    await this.withRuntimeThread(thread, () => this.adapter.interruptTurn({ threadId, turnId: thread.activeTurnId as string }));
    this.publish("turn.interrupt.requested", threadId, thread.activeTurnId, {});
    return this.store.getThread(threadId);
  }

  async forkThread(threadId: string) {
    const source = this.requireThread(threadId);
    const adapterThread = await this.withRuntimeThread(source, () =>
      this.adapter.forkThread({
        sourceThreadId: threadId,
        cwd: source.cwd,
        model: source.model
      })
    );
    const thread = this.createThreadProjection({
      adapterThread,
      projectId: source.projectId,
      title: `${source.title} fork`,
      forkedFromId: adapterThread.forkedFromId ?? threadId,
      goalObjective: source.goalObjective,
      goalStatus: source.goalStatus,
      preview: `Fork of ${source.preview}`,
      tokensUsed: 0
    });
    this.publish("thread.forked", thread.id, null, { thread, sourceThreadId: threadId });
    return thread;
  }

  async setGoal(threadId: string, objective: string, tokenBudget?: number | null) {
    const source = this.requireThread(threadId);
    const goal = await this.withRuntimeThread(source, () => this.adapter.setGoal({ threadId, objective, tokenBudget }));
    const thread = this.store.updateThread(threadId, {
      goalObjective: goal.objective,
      goalStatus: goalStatusFromAdapter(goal),
      tokensUsed: goal.tokensUsed
    });
    this.publish("thread.goal.updated", threadId, null, { goal, thread });
    return goal;
  }

  async getGoal(threadId: string) {
    const source = this.requireThread(threadId);
    return this.withRuntimeThread(source, () => this.adapter.getGoal(threadId));
  }

  async clearGoal(threadId: string) {
    const source = this.requireThread(threadId);
    await this.withRuntimeThread(source, () => this.adapter.clearGoal(threadId));
    const thread = this.store.updateThread(threadId, {
      goalObjective: null,
      goalStatus: "cleared"
    });
    this.publish("thread.goal.cleared", threadId, null, { thread });
    return thread;
  }

  listThreads() {
    return this.store.listThreads();
  }

  getThreadDetail(threadId: string): ThreadDetail {
    const detail = this.store.getThreadDetail(threadId);
    if (!detail) {
      throw new Error(`Thread ${threadId} does not exist`);
    }
    return detail;
  }

  replayEvents(afterId = 0) {
    return this.store.listEvents(afterId);
  }

  async close() {
    await this.adapter.close();
    this.store.close();
  }

  private handleAdapterEvent(event: AdapterEvent) {
    if (event.type === "item.created") {
      const item: ThreadItem = {
        id: event.itemId,
        threadId: event.threadId,
        turnId: event.turnId,
        type: event.itemType,
        text: event.text,
        data: event.data ?? {},
        createdAt: nowIso()
      };
      this.store.createItem(item);
      this.publish("item.created", event.threadId, event.turnId, { item });
      return;
    }

    if (event.type === "item.delta") {
      let item = this.store.appendItemText(event.itemId, event.delta);
      if (!item) {
        item = this.store.createItem({
          id: event.itemId,
          threadId: event.threadId,
          turnId: event.turnId,
          type: "agent",
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
      const completedAt = event.status === "running" ? null : nowIso();
      this.store.updateTurn(event.turnId, {
        status: event.status,
        completedAt,
        durationMs: event.durationMs ?? null
      });
      this.store.updateThread(event.threadId, {
        status: event.status === "completed" ? "idle" : event.status,
        activeTurnId: event.status === "running" ? event.turnId : null
      });
      this.store.updateTasksForThread(event.threadId, taskStatusFromRuntime(event.status));
      this.publish("turn.status", event.threadId, event.turnId, { status: event.status });
      return;
    }

    if (event.type === "thread.status") {
      this.store.updateThread(event.threadId, {
        status: event.status
      });
      this.publish("thread.status", event.threadId, null, { status: event.status });
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

  private createThreadProjection(input: {
    adapterThread: AdapterThread;
    projectId: string;
    title: string;
    forkedFromId?: string | null;
    goalObjective: string | null;
    goalStatus: GoalStatus | null;
    preview?: string;
    tokensUsed: number;
  }) {
    const now = nowIso();
    const thread: ControlThread = {
      id: input.adapterThread.id,
      sessionId: input.adapterThread.sessionId,
      forkedFromId: input.forkedFromId ?? input.adapterThread.forkedFromId,
      projectId: input.projectId,
      title: input.title,
      preview: input.adapterThread.preview || input.preview || input.title,
      cwd: input.adapterThread.cwd,
      model: input.adapterThread.model,
      status: "idle",
      activeTurnId: null,
      goalObjective: input.goalObjective,
      goalStatus: input.goalStatus,
      tokensUsed: input.tokensUsed,
      createdAt: now,
      updatedAt: now
    };
    this.store.createThread(thread);
    return thread;
  }

  private recordTurn(thread: ControlThread, prompt: string, adapterTurn: AdapterTurn) {
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
      preview: prompt
    });
    this.publish("turn.started", thread.id, turn.id, { turn });
    return turn;
  }

  private async startRuntimeTurn(thread: ControlThread, input: StartTurnInput) {
    try {
      return {
        thread,
        adapterTurn: await this.adapter.startTurn({
          threadId: thread.id,
          prompt: input.prompt,
          model: input.model ?? thread.model
        })
      };
    } catch (error) {
      if (!isAdapterThreadNotFoundError(error)) {
        throw error;
      }
    }

    const resumed = await this.tryResumeRuntimeThread(thread);
    if (resumed) {
      try {
        return {
          thread,
          adapterTurn: await this.adapter.startTurn({
            threadId: thread.id,
            prompt: input.prompt,
            model: input.model ?? thread.model
          })
        };
      } catch (error) {
        if (!isAdapterThreadNotFoundError(error)) {
          throw error;
        }
      }
    }

    const continuation = await this.createContinuationThread(thread, input.prompt, input.model ?? thread.model);
    return {
      thread: continuation,
      adapterTurn: await this.adapter.startTurn({
        threadId: continuation.id,
        prompt: input.prompt,
        model: input.model ?? continuation.model
      })
    };
  }

  private async withRuntimeThread<T>(thread: ControlThread, action: () => Promise<T>) {
    try {
      return await action();
    } catch (error) {
      if (!isAdapterThreadNotFoundError(error)) {
        throw error;
      }
    }

    const resumed = await this.tryResumeRuntimeThread(thread);
    if (!resumed) {
      this.markRuntimeThreadLost(thread);
      throw new Error(`Thread ${thread.id} is not loaded by Codex and could not be resumed`);
    }

    try {
      return await action();
    } catch (error) {
      if (isAdapterThreadNotFoundError(error)) {
        this.markRuntimeThreadLost(thread);
      }
      throw error;
    }
  }

  private async tryResumeRuntimeThread(thread: ControlThread) {
    try {
      const adapterThread = await this.adapter.resumeThread({
        threadId: thread.id,
        cwd: thread.cwd,
        model: thread.model
      });
      const updates: Partial<Pick<ControlThread, "status" | "activeTurnId" | "preview">> = {
        status: thread.activeTurnId ? thread.status : "idle",
        preview: adapterThread.preview || thread.preview
      };
      if (!thread.activeTurnId) {
        updates.activeTurnId = null;
      }
      this.store.updateThread(thread.id, {
        ...updates
      });
      this.publish("thread.resumed", thread.id, null, { thread: this.store.getThread(thread.id) });
      return true;
    } catch (error) {
      if (isAdapterThreadNotFoundError(error)) {
        return false;
      }
      throw error;
    }
  }

  private async createContinuationThread(source: ControlThread, prompt: string, model: string | null) {
    this.markRuntimeThreadLost(source);
    const adapterThread = await this.adapter.startThread({
      cwd: source.cwd,
      promptPreview: titleFromPrompt(prompt),
      model
    });
    const thread = this.createThreadProjection({
      adapterThread,
      projectId: source.projectId,
      title: source.title,
      forkedFromId: source.id,
      goalObjective: source.goalObjective,
      goalStatus: source.goalStatus,
      preview: prompt,
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
      this.store.updateTasksForThread(thread.id, "interrupted");
    }
    const updated = this.store.updateThread(thread.id, {
      status: "stale",
      activeTurnId: null
    });
    this.publish("thread.runtime_lost", thread.id, null, { thread: updated });
  }

  private requireProject(projectId: string): Project {
    const project = this.store.getProject(projectId);
    if (!project) {
      throw new Error(`Project ${projectId} does not exist`);
    }
    return project;
  }

  private requireThread(threadId: string): ControlThread {
    const thread = this.store.getThread(threadId);
    if (!thread) {
      throw new Error(`Thread ${threadId} does not exist`);
    }
    return thread;
  }

  private seedRecipes() {
    const createdAt = nowIso();
    this.store.upsertRecipe({
      id: "implement",
      name: "Implement",
      prompt: "Implement the requested change, run focused local verification, and summarize the result.",
      variables: ["request"],
      createdAt
    });
    this.store.upsertRecipe({
      id: "review",
      name: "Review",
      prompt: "Review the current changes for bugs, regressions, missing tests, and risky assumptions.",
      variables: ["scope"],
      createdAt
    });
    this.store.upsertRecipe({
      id: "test",
      name: "Local test",
      prompt: "Run the relevant local test command, inspect failures, and fix the issue if it is in scope.",
      variables: ["command"],
      createdAt
    });
  }
}
