export type RuntimeStatus =
  | "idle"
  | "running"
  | "waiting_approval"
  | "stale"
  | "interrupted"
  | "failed"
  | "completed";

export type TaskStatus = "queued" | "running" | "completed" | "failed" | "interrupted";

export type ApprovalStatus = "pending" | "approved" | "denied";

export type GoalStatus = "in_progress" | "complete" | "blocked" | "cleared";

export type ItemType =
  | "user"
  | "agent"
  | "plan"
  | "command"
  | "file"
  | "approval"
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

export type Approval = {
  id: string;
  adapterRequestId: string | null;
  threadId: string;
  turnId: string | null;
  kind: "command" | "file" | "permissions" | "input" | "tool";
  summary: string;
  status: ApprovalStatus;
  reviewer: string | null;
  createdAt: string;
  resolvedAt: string | null;
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

export type ThreadDetail = ControlThread & {
  turns: Turn[];
  items: ThreadItem[];
  approvals: Approval[];
};

export type DashboardState = {
  projects: Project[];
  tasks: Task[];
  threads: ControlThread[];
  approvals: Approval[];
  recipes: PromptRecipe[];
};

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
