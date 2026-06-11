import { randomUUID } from "node:crypto";
import {
  AdapterThreadNotFoundError,
  type AdapterEvent,
  type AdapterEventHandler,
  type AdapterGoal,
  type AdapterThread,
  type AdapterTurn,
  type CodexAdapter,
  type ForkThreadInput,
  type ResumeThreadInput,
  type StartThreadInput,
  type StartTurnAdapterInput
} from "./adapter.js";

type MockThread = AdapterThread & {
  goal: AdapterGoal | null;
  activeTurnId: string | null;
};

type RunningTurn = {
  threadId: string;
  turnId: string;
  timers: NodeJS.Timeout[];
  startedAt: number;
  completed: boolean;
};

export class MockCodexAdapter implements CodexAdapter {
  readonly name = "mock";
  readonly version = "local";
  private handler: AdapterEventHandler = () => {};
  private readonly threads = new Map<string, MockThread>();
  private readonly running = new Map<string, RunningTurn>();

  constructor(private readonly delayMs = 220) {}

  onEvent(handler: AdapterEventHandler) {
    this.handler = handler;
  }

  async startThread(input: StartThreadInput): Promise<AdapterThread> {
    const id = `thread_${randomUUID()}`;
    const thread: MockThread = {
      id,
      sessionId: `session_${randomUUID()}`,
      forkedFromId: null,
      preview: input.promptPreview,
      cwd: input.cwd,
      model: input.model ?? "mock-codex",
      goal: null,
      activeTurnId: null
    };
    this.threads.set(id, thread);
    return thread;
  }

  async resumeThread(input: ResumeThreadInput): Promise<AdapterThread> {
    return this.requireThread(input.threadId);
  }

  async startTurn(input: StartTurnAdapterInput): Promise<AdapterTurn> {
    const thread = this.requireThread(input.threadId);
    const turnId = `turn_${randomUUID()}`;
    thread.activeTurnId = turnId;
    const running: RunningTurn = {
      threadId: input.threadId,
      turnId,
      timers: [],
      startedAt: Date.now(),
      completed: false
    };
    this.running.set(turnId, running);

    const planId = `item_plan_${randomUUID()}`;
    const answerId = `item_agent_${randomUUID()}`;
    const needsApproval = /approval|approve|rm\s|-rf|danger|sudo/i.test(input.prompt);
    const steps: Array<() => void> = [
      () =>
        this.emit({
          type: "item.created",
          threadId: input.threadId,
          turnId,
          itemId: `item_user_${randomUUID()}`,
          itemType: "user",
          text: input.prompt,
          data: { source: "mock" }
        }),
      () =>
        this.emit({
          type: "thread.status",
          threadId: input.threadId,
          status: "running"
        }),
      () =>
        this.emit({
          type: "item.created",
          threadId: input.threadId,
          turnId,
          itemId: planId,
          itemType: "plan",
          text: "Inspect request, stage implementation, run local verification.",
          data: { adapter: "mock" }
        }),
      () =>
        this.emit({
          type: "item.created",
          threadId: input.threadId,
          turnId,
          itemId: answerId,
          itemType: "agent",
          text: "",
          data: { adapter: "mock" }
        })
    ];

    for (const chunk of this.mockAnswer(input.prompt)) {
      steps.push(() =>
        this.emit({
          type: "item.delta",
          threadId: input.threadId,
          turnId,
          itemId: answerId,
          delta: chunk
        })
      );
    }

    if (needsApproval) {
      steps.push(() =>
        this.emit({
          type: "approval.requested",
          adapterRequestId: `approval_${randomUUID()}`,
          threadId: input.threadId,
          turnId,
          kind: "command",
          summary: "Mock command approval requested for a high-risk shell action."
        })
      );
      steps.push(() =>
        this.emit({
          type: "thread.status",
          threadId: input.threadId,
          status: "waiting_approval"
        })
      );
    } else {
      steps.push(() => this.completeTurn(running, "completed"));
    }

    setTimeout(() => this.schedule(running, steps), 0);
    return { id: turnId, status: "running" };
  }

  async steerTurn(input: { threadId: string; turnId: string; prompt: string }) {
    this.requireThread(input.threadId);
    this.emit({
      type: "item.created",
      threadId: input.threadId,
      turnId: input.turnId,
      itemId: `item_steer_${randomUUID()}`,
      itemType: "user",
      text: input.prompt,
      data: { steer: true }
    });
    this.emit({
      type: "item.created",
      threadId: input.threadId,
      turnId: input.turnId,
      itemId: `item_agent_${randomUUID()}`,
      itemType: "agent",
      text: `Steer received: ${input.prompt}`,
      data: { adapter: "mock" }
    });
  }

  async interruptTurn(input: { threadId: string; turnId: string }) {
    this.requireThread(input.threadId);
    const running = this.running.get(input.turnId);
    if (running) {
      for (const timer of running.timers) {
        clearTimeout(timer);
      }
      this.completeTurn(running, "interrupted");
    }
  }

  async forkThread(input: ForkThreadInput): Promise<AdapterThread> {
    const source = this.requireThread(input.sourceThreadId);
    const id = `thread_${randomUUID()}`;
    const thread: MockThread = {
      id,
      sessionId: source.sessionId,
      forkedFromId: source.id,
      preview: `Fork of ${source.preview}`,
      cwd: input.cwd,
      model: input.model ?? source.model,
      goal: source.goal,
      activeTurnId: null
    };
    this.threads.set(id, thread);
    return thread;
  }

  async setGoal(input: { threadId: string; objective: string; tokenBudget?: number | null }) {
    const thread = this.requireThread(input.threadId);
    const goal: AdapterGoal = {
      objective: input.objective,
      status: "in_progress",
      tokenBudget: input.tokenBudget ?? null,
      tokensUsed: 0
    };
    thread.goal = goal;
    return goal;
  }

  async getGoal(threadId: string) {
    return this.requireThread(threadId).goal;
  }

  async clearGoal(threadId: string) {
    this.requireThread(threadId).goal = null;
  }

  async resolveApproval(input: { approvalId: string; adapterRequestId: string | null; approved: boolean }) {
    const active = [...this.running.values()].find((turn) => !turn.completed);
    if (!active) {
      return;
    }
    if (!input.approved) {
      this.emit({
        type: "item.created",
        threadId: active.threadId,
        turnId: active.turnId,
        itemId: `item_denied_${randomUUID()}`,
        itemType: "system",
        text: "Approval denied.",
        data: { approvalId: input.approvalId, adapterRequestId: input.adapterRequestId }
      });
      this.completeTurn(active, "interrupted");
      return;
    }
    this.emit({
      type: "item.created",
      threadId: active.threadId,
      turnId: active.turnId,
      itemId: `item_approved_${randomUUID()}`,
      itemType: "system",
      text: "Approval accepted.",
      data: { approvalId: input.approvalId, adapterRequestId: input.adapterRequestId }
    });
    this.completeTurn(active, "completed");
  }

  async close() {
    for (const running of this.running.values()) {
      for (const timer of running.timers) {
        clearTimeout(timer);
      }
    }
    this.running.clear();
  }

  private schedule(running: RunningTurn, steps: Array<() => void>) {
    if (this.delayMs <= 0) {
      for (const step of steps) {
        if (!running.completed) {
          step();
        }
      }
      return;
    }
    steps.forEach((step, index) => {
      const timer = setTimeout(() => {
        if (!running.completed) {
          step();
        }
      }, this.delayMs * index);
      running.timers.push(timer);
    });
  }

  private completeTurn(running: RunningTurn, status: "completed" | "interrupted" | "failed") {
    if (running.completed) {
      return;
    }
    running.completed = true;
    const durationMs = Date.now() - running.startedAt;
    this.running.delete(running.turnId);
    const thread = this.threads.get(running.threadId);
    if (thread?.activeTurnId === running.turnId) {
      thread.activeTurnId = null;
    }
    this.emit({
      type: "turn.status",
      threadId: running.threadId,
      turnId: running.turnId,
      status,
      durationMs
    });
    this.emit({
      type: "thread.status",
      threadId: running.threadId,
      status: status === "completed" ? "idle" : status
    });
  }

  private mockAnswer(prompt: string) {
    const trimmed = prompt.trim().replace(/\s+/g, " ");
    return [
      "Mock run started. ",
      "The control plane accepted the task and produced deterministic transcript output. ",
      `Prompt preview: ${trimmed.slice(0, 96)}`
    ];
  }

  private requireThread(id: string) {
    const thread = this.threads.get(id);
    if (!thread) {
      throw new AdapterThreadNotFoundError(id, `Mock thread ${id} does not exist`);
    }
    return thread;
  }

  private emit(event: AdapterEvent) {
    this.handler(event);
  }
}
