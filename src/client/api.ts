import type {
  ControlThread,
  DashboardState,
  GoalStatus,
  Project,
  QueuedPrompt,
  TerminalSnapshot,
  ThreadDetail,
  ThreadPage,
  Turn
} from "../server/domain.js";

function formatHostnameForUrl(hostname: string) {
  return hostname.includes(":") && !hostname.startsWith("[") ? `[${hostname}]` : hostname;
}

function browserReachableHostname(fallback: string) {
  if (typeof window === "undefined") {
    return fallback;
  }
  const hostname = window.location.hostname;
  if (hostname && hostname !== "0.0.0.0" && hostname !== "::" && hostname !== "[::]") {
    return hostname;
  }
  return fallback;
}

function normalizeApiBaseUrl(value: string | undefined) {
  const trimmed = value?.trim().replace(/\/+$/, "") ?? "";
  if (!trimmed || typeof window === "undefined") {
    return trimmed;
  }

  let url: URL;
  try {
    url = new URL(trimmed, window.location.href);
  } catch {
    return trimmed;
  }

  if (url.hostname === "0.0.0.0") {
    url.hostname = formatHostnameForUrl(browserReachableHostname("127.0.0.1"));
    return url.toString().replace(/\/+$/, "");
  }
  if (url.hostname === "[::]") {
    url.hostname = formatHostnameForUrl(browserReachableHostname("[::1]"));
    return url.toString().replace(/\/+$/, "");
  }
  return trimmed;
}

const apiBaseUrl = normalizeApiBaseUrl(import.meta.env.VITE_CODEX_XYZ_API_URL);

export function apiUrl(path: string) {
  return apiBaseUrl ? `${apiBaseUrl}${path}` : path;
}

export function apiWebSocketUrl(path: string) {
  const url = new URL(apiUrl(path), window.location.href);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
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

export function getThreadsPage(input: { limit: number; offset: number }) {
  const params = new URLSearchParams({
    limit: String(input.limit),
    offset: String(input.offset)
  });
  return request<ThreadPage>(`/api/threads?${params.toString()}`);
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
  goalMode?: boolean | null;
  title?: string | null;
  recipeId?: string | null;
  model?: string | null;
}) {
  return request<{
    task: unknown;
    thread: ControlThread | null;
    turn: Turn | null;
    goal: {
      objective: string;
      status: GoalStatus;
      tokenBudget: number | null;
      tokensUsed: number;
    } | null;
  }>("/api/tasks", {
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

export function queueTurn(threadId: string, prompt: string) {
  return request<QueuedPrompt[]>(`/api/threads/${threadId}/queue`, {
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

export function startGoal(threadId: string, objective: string, tokenBudget?: number | null) {
  return request<{
    goal: {
      objective: string;
      status: GoalStatus;
      tokenBudget: number | null;
      tokensUsed: number;
    };
    turn: Turn;
    thread: ControlThread | null;
  }>(`/api/threads/${threadId}/goal`, {
    method: "PUT",
    body: JSON.stringify({ objective, tokenBudget: tokenBudget ?? null })
  });
}

export function setGoalStatus(threadId: string, status: "active" | "paused" | "complete") {
  return request<{
    goal: {
      objective: string;
      status: GoalStatus;
      tokenBudget: number | null;
      tokensUsed: number;
    };
    thread: ControlThread | null;
  }>(`/api/threads/${threadId}/goal/status`, {
    method: "PUT",
    body: JSON.stringify({ status })
  });
}

export function clearGoal(threadId: string) {
  return request<ControlThread>(`/api/threads/${threadId}/goal`, {
    method: "DELETE"
  });
}

export function getTerminal() {
  return request<TerminalSnapshot>("/api/terminal");
}

export function startTerminal(input: { cols?: number | null; rows?: number | null } = {}) {
  return request<TerminalSnapshot>("/api/terminal/start", {
    method: "POST",
    body: JSON.stringify({
      cols: input.cols ?? null,
      rows: input.rows ?? null
    })
  });
}

export function writeTerminalInput(data: string) {
  return request<void>("/api/terminal/input", {
    method: "POST",
    body: JSON.stringify({ data })
  });
}

export function resizeTerminal(input: { cols?: number | null; rows?: number | null }) {
  return request<TerminalSnapshot>("/api/terminal/resize", {
    method: "POST",
    body: JSON.stringify({
      cols: input.cols ?? null,
      rows: input.rows ?? null
    })
  });
}

export function terminateTerminal() {
  return request<TerminalSnapshot>("/api/terminal/terminate", {
    method: "POST",
    body: JSON.stringify({})
  });
}
