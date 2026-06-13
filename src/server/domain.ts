export type RuntimeStatus =
  | "idle"
  | "running"
  | "stale"
  | "interrupted"
  | "failed"
  | "completed";

export type TaskStatus = "queued" | "running" | "completed" | "failed" | "interrupted";

export type GoalStatus = "in_progress" | "complete" | "blocked" | "cleared";

export type ItemType =
  | "user"
  | "agent"
  | "plan"
  | "command"
  | "file"
  | "system";

export type Project = {
  id: string;
  name: string;
  path: string;
  gitRemote: string | null;
  defaultBranch: string | null;
  tags: string[];
  createdAt: string;
  updatedAt: string;
};

export type ControlThread = {
  id: string;
  sessionId: string;
  forkedFromId: string | null;
  projectId: string;
  title: string;
  preview: string;
  cwd: string;
  model: string | null;
  status: RuntimeStatus;
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
  status: RuntimeStatus;
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

export type Task = {
  id: string;
  projectId: string;
  threadId: string | null;
  title: string;
  prompt: string;
  recipeId: string | null;
  status: TaskStatus;
  createdAt: string;
  updatedAt: string;
};

export type PromptRecipe = {
  id: string;
  name: string;
  prompt: string;
  variables: string[];
  createdAt: string;
};

export type EvalRun = {
  id: string;
  taskId: string;
  command: string;
  status: "pending" | "running" | "passed" | "failed";
  output: string | null;
  createdAt: string;
  completedAt: string | null;
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
  "project.upserted",
  "task.created",
  "turn.started",
  "turn.status",
  "turn.steered",
  "turn.interrupt.requested",
  "thread.started",
  "thread.resumed",
  "thread.status",
  "thread.runtime_lost",
  "thread.continued",
  "thread.forked",
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
  projects: Project[];
  tasks: Task[];
  threads: ControlThread[];
  threadTotalCount: number;
  threadPageSize: number;
  threadNextOffset: number;
  threadHasMore: boolean;
  recipes: PromptRecipe[];
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

export type CreateTaskInput = {
  projectId: string;
  prompt: string;
  recipeId?: string | null;
  title?: string | null;
  model?: string | null;
};

export type StartTurnInput = {
  threadId: string;
  prompt: string;
  model?: string | null;
};

export type RenameThreadInput = {
  threadId: string;
  title: string;
};

export type SetGoalInput = {
  threadId: string;
  objective: string;
  tokenBudget?: number | null;
};

export function nowIso() {
  return new Date().toISOString();
}

export function titleFromPrompt(prompt: string) {
  const collapsed = prompt.trim().replace(/\s+/g, " ");
  if (collapsed.length <= 72) {
    return collapsed || "Untitled task";
  }
  return `${collapsed.slice(0, 69)}...`;
}
