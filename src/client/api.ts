import type {
  ControlThread,
  DashboardState,
  GoalStatus,
  Project,
  ThreadDetail,
  Turn
} from "../server/domain.js";

const apiBaseUrl = import.meta.env.VITE_CODEX_XYZ_API_URL?.trim().replace(/\/+$/, "") ?? "";

export function apiUrl(path: string) {
  return apiBaseUrl ? `${apiBaseUrl}${path}` : path;
}

async function request<T>(path: string, options: RequestInit = {}) {
  const response = await fetch(apiUrl(path), {
    ...options,
    headers: {
      "content-type": "application/json",
      ...options.headers
    }
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Request failed: ${response.status}`);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

export function getState() {
  return request<DashboardState>("/api/state");
}

export function getThread(threadId: string) {
  return request<ThreadDetail>(`/api/threads/${threadId}`);
}

export function createProject(input: { name?: string | null; path: string }) {
  return request<Project>("/api/projects", {
    method: "POST",
    body: JSON.stringify({
      name: input.name ?? null,
      path: input.path
    })
  });
}

export function createTask(input: {
  projectId: string;
  prompt: string;
  title?: string | null;
  recipeId?: string | null;
  model?: string | null;
}) {
  return request<{ task: unknown; thread: unknown; turn: Turn }>("/api/tasks", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function startTurn(threadId: string, prompt: string) {
  return request<Turn>(`/api/threads/${threadId}/turns`, {
    method: "POST",
    body: JSON.stringify({ prompt })
  });
}

export function steerTurn(threadId: string, prompt: string) {
  return request<void>(`/api/threads/${threadId}/steer`, {
    method: "POST",
    body: JSON.stringify({ prompt })
  });
}

export function interruptTurn(threadId: string) {
  return request<ControlThread>(`/api/threads/${threadId}/interrupt`, {
    method: "POST",
    body: JSON.stringify({})
  });
}

export function forkThread(threadId: string) {
  return request<ControlThread>(`/api/threads/${threadId}/fork`, {
    method: "POST",
    body: JSON.stringify({})
  });
}

export function resumeThread(threadId: string) {
  return request<ControlThread>(`/api/threads/${threadId}/resume`, {
    method: "POST",
    body: JSON.stringify({})
  });
}

export function renameThread(threadId: string, title: string) {
  return request<ControlThread>(`/api/threads/${threadId}/name`, {
    method: "PUT",
    body: JSON.stringify({ title })
  });
}

export function setGoal(threadId: string, objective: string, tokenBudget?: number | null) {
  return request<{
    objective: string;
    status: GoalStatus;
    tokenBudget: number | null;
    tokensUsed: number;
  }>(`/api/threads/${threadId}/goal`, {
    method: "PUT",
    body: JSON.stringify({ objective, tokenBudget: tokenBudget ?? null })
  });
}

export function clearGoal(threadId: string) {
  return request<ControlThread>(`/api/threads/${threadId}/goal`, {
    method: "DELETE"
  });
}
