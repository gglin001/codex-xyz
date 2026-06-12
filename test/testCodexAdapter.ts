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
  type RunShellCommandInput,
  type ResumeThreadInput,
  type StartThreadInput,
  type StartTurnAdapterInput
} from "../src/server/codex/adapter.js";

type TestThread = AdapterThread & {
  goal: AdapterGoal | null;
  activeTurnId: string | null;
};

type RunningTurn = {
  threadId: string;
  turnId: string;
  startedAt: number;
  completed: boolean;
};

export class TestCodexAdapter implements CodexAdapter {
  readonly name = "test";
  readonly version = "test";
  private handler: AdapterEventHandler = () => {};
  private readonly threads = new Map<string, TestThread>();
  private readonly running = new Map<string, RunningTurn>();
  private closed = false;

  onEvent(handler: AdapterEventHandler) {
    this.handler = handler;
  }

  async startThread(input: StartThreadInput): Promise<AdapterThread> {
    this.closed = false;
    const id = randomUUID();
    const thread: TestThread = {
      id,
      sessionId: id,
      forkedFromId: null,
      preview: input.promptPreview,
      cwd: input.cwd,
      model: input.model ?? "test-codex",
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
    const running: RunningTurn = {
      threadId: input.threadId,
      turnId,
      startedAt: Date.now(),
      completed: false
    };
    thread.activeTurnId = turnId;
    this.running.set(turnId, running);
    setTimeout(() => this.emitTurnOutput(input, turnId, running), 0);
    return { id: turnId, status: "running" };
  }

  async runShellCommand(input: RunShellCommandInput): Promise<AdapterTurn> {
    const thread = this.requireThread(input.threadId);
    const turnId = input.activeTurnId ?? `turn_${randomUUID()}`;
    const startedAt = Date.now();
    const running: RunningTurn = {
      threadId: input.threadId,
      turnId,
      startedAt,
      completed: false
    };

    if (!input.activeTurnId) {
      thread.activeTurnId = turnId;
      this.running.set(turnId, running);
      this.emit({
        type: "turn.started",
        threadId: input.threadId,
        turnId,
        prompt: `!${input.command}`
      });
    }

    setTimeout(() => this.emitShellCommandOutput(input, turnId, running), 0);
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
      data: { adapter: "test" }
    });
  }

  async interruptTurn(input: { threadId: string; turnId: string }) {
    this.requireThread(input.threadId);
    const running = this.running.get(input.turnId);
    if (running) {
      this.completeTurn(running, "interrupted");
    }
  }

  async forkThread(input: ForkThreadInput): Promise<AdapterThread> {
    const source = this.requireThread(input.sourceThreadId);
    const id = randomUUID();
    const thread: TestThread = {
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

  async renameThread(input: { threadId: string; title: string }) {
    const thread = this.requireThread(input.threadId);
    thread.preview = input.title;
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

  async close() {
    this.closed = true;
    this.running.clear();
    this.threads.clear();
  }

  private emitTurnOutput(input: StartTurnAdapterInput, turnId: string, running: RunningTurn) {
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
      data: { source: "test" }
    });
    this.emit({
      type: "thread.status",
      threadId: input.threadId,
      status: "running"
    });
    this.emit({
      type: "item.created",
      threadId: input.threadId,
      turnId,
      itemId: answerId,
      itemType: "agent",
      text: "",
      data: { adapter: "test" }
    });
    this.emit({
      type: "item.delta",
      threadId: input.threadId,
      turnId,
      itemId: answerId,
      delta: this.answer(input.prompt)
    });

    if (this.shouldStayRunning(input.prompt)) {
      return;
    }

    this.completeTurn(running, "completed");
  }

  private emitShellCommandOutput(input: RunShellCommandInput, turnId: string, running: RunningTurn) {
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
        status: "running"
      }
    });
    this.emit({
      type: "item.delta",
      threadId: input.threadId,
      turnId,
      itemId,
      delta: output
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
        exitCode: 0
      }
    });

    if (!input.activeTurnId) {
      this.completeTurn(running, "completed");
    }
  }

  private completeTurn(running: RunningTurn, status: "completed" | "interrupted" | "failed") {
    if (running.completed) {
      return;
    }
    running.completed = true;
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
      durationMs: Date.now() - running.startedAt
    });
    this.emit({
      type: "thread.status",
      threadId: running.threadId,
      status: status === "completed" ? "idle" : status
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
      `Prompt preview: ${trimmed.slice(0, 96)}`
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
      throw new AdapterThreadNotFoundError(id, `Test thread ${id} does not exist`);
    }
    return thread;
  }

  private emit(event: AdapterEvent) {
    this.handler(event);
  }
}
