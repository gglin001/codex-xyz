import { basename } from "node:path";
import { randomUUID } from "node:crypto";
import {
  type Approval,
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
import type { AdapterEvent, AdapterGoal, CodexAdapter } from "./codex/adapter.js";

function taskStatusFromRuntime(status: RuntimeStatus): Task["status"] {
  if (status === "completed" || status === "idle") {
    return "completed";
  }
  if (status === "failed") {
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

export class ControlService {
  constructor(
    readonly store: Store,
    readonly adapter: CodexAdapter,
    readonly events = new EventBus()
  ) {
    this.adapter.onEvent((event) => this.handleAdapterEvent(event));
  }

  seedLocalState(input: { cwd: string; adapterName: string; cliVersion?: string | null }) {
    this.store.upsertHost({
      id: "local",
      name: "Local host",
      adapter: input.adapterName,
      version: input.cliVersion ?? null
    });
    const existing = this.store.getProjectByPath(input.cwd);
    if (!existing) {
      this.store.createProject({
        id: "local",
        name: basename(input.cwd),
        path: input.cwd,
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
      approvals: this.store.listApprovals({ status: "pending" }),
      recipes: this.store.listRecipes()
    };
  }

  listProjects() {
    return this.store.listProjects();
  }

  createProject(input: { name: string; path: string; tags?: string[] }) {
    const project = this.store.createProject({
      id: randomUUID(),
      name: input.name,
      path: input.path,
      tags: input.tags ?? []
    });
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
    const threadNow = nowIso();
    const thread: ControlThread = {
      id: adapterThread.id,
      sessionId: adapterThread.sessionId,
      forkedFromId: adapterThread.forkedFromId,
      projectId: project.id,
      title: task.title,
      preview: adapterThread.preview || task.title,
      cwd: adapterThread.cwd,
      model: adapterThread.model,
      status: "idle",
      activeTurnId: null,
      goalObjective: null,
      goalStatus: null,
      tokensUsed: 0,
      createdAt: threadNow,
      updatedAt: threadNow
    };
    this.store.createThread(thread);
    this.store.updateTask(task.id, { threadId: thread.id, status: "running" });
    this.publish("thread.started", thread.id, null, { thread });

    const turn = await this.startTurn({
      threadId: thread.id,
      prompt: input.prompt,
      model: input.model ?? null
    });
    return {
      task: this.store.getTask(task.id),
      thread: this.store.getThread(thread.id),
      turn
    };
  }

  async startTurn(input: StartTurnInput) {
    const thread = this.requireThread(input.threadId);
    const adapterTurn = await this.adapter.startTurn(input);
    const now = nowIso();
    const turn: Turn = {
      id: adapterTurn.id,
      threadId: thread.id,
      status: "running",
      prompt: input.prompt,
      startedAt: now,
      completedAt: null,
      durationMs: null
    };
    this.store.createTurn(turn);
    this.store.updateThread(thread.id, {
      status: "running",
      activeTurnId: turn.id,
      preview: input.prompt
    });
    this.publish("turn.started", thread.id, turn.id, { turn });
    return turn;
  }

  async steerTurn(threadId: string, prompt: string) {
    const thread = this.requireThread(threadId);
    if (!thread.activeTurnId) {
      throw new Error("Thread has no active turn to steer");
    }
    await this.adapter.steerTurn({
      threadId,
      turnId: thread.activeTurnId,
      prompt
    });
    this.publish("turn.steered", threadId, thread.activeTurnId, { prompt });
  }

  async interruptTurn(threadId: string) {
    const thread = this.requireThread(threadId);
    if (!thread.activeTurnId) {
      return thread;
    }
    await this.adapter.interruptTurn({ threadId, turnId: thread.activeTurnId });
    this.publish("turn.interrupt.requested", threadId, thread.activeTurnId, {});
    return this.store.getThread(threadId);
  }

  async forkThread(threadId: string) {
    const source = this.requireThread(threadId);
    const adapterThread = await this.adapter.forkThread({
      sourceThreadId: threadId,
      cwd: source.cwd,
      model: source.model
    });
    const now = nowIso();
    const thread: ControlThread = {
      id: adapterThread.id,
      sessionId: adapterThread.sessionId,
      forkedFromId: adapterThread.forkedFromId ?? threadId,
      projectId: source.projectId,
      title: `${source.title} fork`,
      preview: adapterThread.preview,
      cwd: adapterThread.cwd,
      model: adapterThread.model,
      status: "idle",
      activeTurnId: null,
      goalObjective: source.goalObjective,
      goalStatus: source.goalStatus,
      tokensUsed: 0,
      createdAt: now,
      updatedAt: now
    };
    this.store.createThread(thread);
    this.publish("thread.forked", thread.id, null, { thread, sourceThreadId: threadId });
    return thread;
  }

  async setGoal(threadId: string, objective: string, tokenBudget?: number | null) {
    this.requireThread(threadId);
    const goal = await this.adapter.setGoal({ threadId, objective, tokenBudget });
    const thread = this.store.updateThread(threadId, {
      goalObjective: goal.objective,
      goalStatus: goalStatusFromAdapter(goal),
      tokensUsed: goal.tokensUsed
    });
    this.publish("thread.goal.updated", threadId, null, { goal, thread });
    return goal;
  }

  async getGoal(threadId: string) {
    this.requireThread(threadId);
    return this.adapter.getGoal(threadId);
  }

  async clearGoal(threadId: string) {
    this.requireThread(threadId);
    await this.adapter.clearGoal(threadId);
    const thread = this.store.updateThread(threadId, {
      goalObjective: null,
      goalStatus: "cleared"
    });
    this.publish("thread.goal.cleared", threadId, null, { thread });
    return thread;
  }

  async resolveApproval(approvalId: string, approved: boolean, reviewer = "local") {
    const approval = this.store.getApproval(approvalId);
    if (!approval) {
      throw new Error(`Approval ${approvalId} does not exist`);
    }
    const resolved = this.store.updateApproval(approvalId, {
      status: approved ? "approved" : "denied",
      reviewer,
      resolvedAt: nowIso()
    });
    await this.adapter.resolveApproval({
      approvalId,
      adapterRequestId: approval.adapterRequestId,
      approved
    });
    this.publish("approval.resolved", approval.threadId, approval.turnId, {
      approval: resolved
    });
    return resolved;
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

  listApprovals() {
    return this.store.listApprovals();
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

    if (event.type === "approval.requested") {
      const approval: Approval = {
        id: randomUUID(),
        adapterRequestId: event.adapterRequestId,
        threadId: event.threadId,
        turnId: event.turnId,
        kind: event.kind,
        summary: event.summary,
        status: "pending",
        reviewer: null,
        createdAt: nowIso(),
        resolvedAt: null
      };
      this.store.createApproval(approval);
      if (this.store.getThread(event.threadId)) {
        this.store.updateThread(event.threadId, { status: "waiting_approval" });
      }
      this.publish("approval.requested", event.threadId, event.turnId, { approval });
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
