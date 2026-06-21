export type ThreadRuntimeStatus = "idle" | "running" | "stale" | "failed";
export type TurnRuntimeStatus = "running" | "completed" | "interrupted" | "failed";
export type RuntimeStatus = ThreadRuntimeStatus | TurnRuntimeStatus;

export type GoalStatus =
  | "in_progress"
  | "paused"
  | "blocked"
  | "usage_limited"
  | "budget_limited"
  | "complete"
  | "cleared";
export type GoalStatusUpdate = "active" | "paused" | "complete";

export type ItemType =
  | "user"
  | "agent"
  | "plan"
  | "command"
  | "file"
  | "system";

export type ControlThread = {
  id: string;
  sessionId: string;
  forkedFromId: string | null;
  title: string;
  preview: string;
  cwd: string;
  model: string | null;
  status: ThreadRuntimeStatus;
  activeTurnId: string | null;
  goalObjective: string | null;
  goalStatus: GoalStatus | null;
  goalTokenBudget: number | null;
  tokensUsed: number;
  createdAt: string;
  updatedAt: string;
};

export type Turn = {
  id: string;
  threadId: string;
  status: TurnRuntimeStatus;
  prompt: string;
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
};

export type ThreadItem = {
  id: string;
  threadId: string;
  turnId: string | null;
  type: ItemType;
  text: string;
  data: Record<string, unknown>;
  createdAt: string;
};

export type XyzEvent = {
  id: number;
  type: string;
  threadId: string | null;
  turnId: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
};

export const summaryEventTypes = [
  "turn.started",
  "turn.status",
  "turn.steered",
  "turn.interrupt.requested",
  "thread.started",
  "thread.resumed",
  "thread.status",
  "thread.runtime_lost",
  "thread.continued",
  "thread.renamed",
  "thread.goal.updated",
  "thread.goal.cleared",
  "thread.token_usage"
] as const;

export function isSummaryEventType(type: string) {
  return summaryEventTypes.includes(type as (typeof summaryEventTypes)[number]);
}

export type ThreadDetail = ControlThread & {
  turns: Turn[];
  items: ThreadItem[];
  latestEventId: number;
};

export type ThreadPage = {
  threads: ControlThread[];
  totalCount: number;
  offset: number;
  limit: number;
  nextOffset: number;
  hasMore: boolean;
};

export type DashboardState = {
  threads: ControlThread[];
  threadTotalCount: number;
  threadPageSize: number;
  threadNextOffset: number;
  threadHasMore: boolean;
  defaultCwd: string;
  latestEventId: number;
};

export type TerminalProcessStatus = "idle" | "starting" | "running" | "exited" | "failed";

export type TerminalStats = {
  ptyOutputChunks: number;
  ptyOutputBytes: number;
  outputFlushes: number;
  outputEventBytes: number;
  inputWrites: number;
  inputBytes: number;
  modelWrites: number;
  modelWriteBytes: number;
  modelWriteMs: number;
  modelPendingWrites: number;
  pendingOutputBytes: number;
  replayEvents: number;
  replayBytes: number;
  outputPaused: boolean;
  outputPauseCount: number;
  outputResumeCount: number;
};

export type TerminalSnapshot = {
  status: TerminalProcessStatus;
  command: string;
  cwd: string;
  pid: number | null;
  cols: number;
  rows: number;
  sequence: number;
  screen: string;
  title: string | null;
  startedAt: string | null;
  updatedAt: string;
  exitCode: number | null;
  signal: number | string | null;
  error: string | null;
  stats: TerminalStats;
};

export type TerminalOutputEvent = {
  sequence: number;
  type: "terminal.output";
  data: string;
  createdAt: string;
};

export type TerminalStatusEvent = {
  sequence: number;
  type: "terminal.status";
  snapshot: TerminalSnapshot;
  createdAt: string;
};

export type TerminalEvent = TerminalOutputEvent | TerminalStatusEvent;

export type CreateSessionInput = {
  cwd: string;
  prompt: string;
  goalMode?: boolean | null;
  title?: string | null;
  model?: string | null;
};

export type StartTurnInput = {
  threadId: string;
  prompt: string;
  model?: string | null;
};

export type SetGoalInput = {
  threadId: string;
  objective: string;
  tokenBudget?: number | null;
};

export type SetGoalStatusInput = {
  threadId: string;
  status: GoalStatusUpdate;
};

export function nowIso() {
  return new Date().toISOString();
}

export function titleFromPrompt(prompt: string) {
  const collapsed = prompt.trim().replace(/\s+/g, " ");
  if (collapsed.length <= 72) {
    return collapsed || "Untitled session";
  }
  return `${collapsed.slice(0, 69)}...`;
}
