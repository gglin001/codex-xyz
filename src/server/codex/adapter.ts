import type { GoalStatus, RuntimeStatus } from "../domain.js";

export type AdapterThread = {
  id: string;
  sessionId: string;
  forkedFromId: string | null;
  preview: string;
  cwd: string;
  model: string | null;
};

export type AdapterTurn = {
  id: string;
  status: RuntimeStatus;
};

export type AdapterGoal = {
  objective: string;
  status: GoalStatus;
  tokenBudget: number | null;
  tokensUsed: number;
};

export type AdapterEvent =
  | {
      type: "item.created";
      threadId: string;
      turnId: string | null;
      itemId: string;
      itemType: "user" | "agent" | "plan" | "command" | "file" | "approval" | "system";
      text: string;
      data?: Record<string, unknown>;
    }
  | {
      type: "item.delta";
      threadId: string;
      turnId: string;
      itemId: string;
      delta: string;
    }
  | {
      type: "turn.status";
      threadId: string;
      turnId: string;
      status: RuntimeStatus;
      durationMs?: number | null;
    }
  | {
      type: "thread.status";
      threadId: string;
      status: RuntimeStatus;
    }
  | {
      type: "approval.requested";
      adapterRequestId: string | null;
      threadId: string;
      turnId: string | null;
      kind: "command" | "file" | "permissions" | "input" | "tool";
      summary: string;
    }
  | {
      type: "raw";
      threadId?: string | null;
      turnId?: string | null;
      method: string;
      payload: Record<string, unknown>;
    };

export type AdapterEventHandler = (event: AdapterEvent) => void;

export type StartThreadInput = {
  cwd: string;
  promptPreview: string;
  model?: string | null;
};

export type StartTurnAdapterInput = {
  threadId: string;
  prompt: string;
  model?: string | null;
};

export type ForkThreadInput = {
  sourceThreadId: string;
  cwd: string;
  model?: string | null;
};

export interface CodexAdapter {
  readonly name: string;
  readonly version: string | null;
  onEvent(handler: AdapterEventHandler): void;
  startThread(input: StartThreadInput): Promise<AdapterThread>;
  startTurn(input: StartTurnAdapterInput): Promise<AdapterTurn>;
  steerTurn(input: { threadId: string; turnId: string; prompt: string }): Promise<void>;
  interruptTurn(input: { threadId: string; turnId: string }): Promise<void>;
  forkThread(input: ForkThreadInput): Promise<AdapterThread>;
  setGoal(input: { threadId: string; objective: string; tokenBudget?: number | null }): Promise<AdapterGoal>;
  getGoal(threadId: string): Promise<AdapterGoal | null>;
  clearGoal(threadId: string): Promise<void>;
  resolveApproval(input: { approvalId: string; adapterRequestId: string | null; approved: boolean }): Promise<void>;
  close(): Promise<void>;
}
