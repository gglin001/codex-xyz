import type {
  Approval,
  DashboardState,
  ThreadDetail,
  Turn
} from "../server/domain.js";

async function request<T>(path: string, options: RequestInit = {}) {
  const response = await fetch(path, {
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
  return request(`/api/threads/${threadId}/interrupt`, {
    method: "POST",
    body: JSON.stringify({})
  });
}

export function forkThread(threadId: string) {
  return request(`/api/threads/${threadId}/fork`, {
    method: "POST",
    body: JSON.stringify({})
  });
}

export function setGoal(threadId: string, objective: string) {
  return request(`/api/threads/${threadId}/goal`, {
    method: "PUT",
    body: JSON.stringify({ objective })
  });
}

export function clearGoal(threadId: string) {
  return request(`/api/threads/${threadId}/goal`, {
    method: "DELETE"
  });
}

export function resolveApproval(approval: Approval, approved: boolean) {
  return request<Approval>(`/api/approvals/${approval.id}/resolve`, {
    method: "POST",
    body: JSON.stringify({ approved, reviewer: "local" })
  });
}
