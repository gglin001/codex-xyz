import type {
	CodexAppServerRestartResponse,
	ControlThread,
	DashboardState,
	GoalStatus,
	TerminalSnapshot,
	ThreadDetail,
	ThreadItemPageCursor,
	ThreadItemsPage,
	ThreadPage,
	ThreadPageCursor,
	Turn,
} from "../server/domain.js";

export function apiUrl(path: string) {
	return path;
}

async function request<T>(path: string, options: RequestInit = {}) {
	const response = await fetch(apiUrl(path), {
		...options,
		cache: "no-store",
		headers: {
			"content-type": "application/json",
			...options.headers,
		},
	});
	if (!response.ok) {
		const body = (await response.json().catch(() => ({}))) as {
			error?: string;
		};
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

export function getThreadItemsPage(input: {
	threadId: string;
	limit: number;
	cursor?: ThreadItemPageCursor | null;
}) {
	const params = new URLSearchParams({
		limit: String(input.limit),
	});
	if (input.cursor) {
		params.set("cursorCreatedAt", input.cursor.createdAt);
		params.set("cursorId", input.cursor.id);
	}
	return request<ThreadItemsPage>(
		`/api/threads/${encodeURIComponent(input.threadId)}/items?${params.toString()}`,
	);
}

export function getThreadsPage(input: {
	limit: number;
	cursor?: ThreadPageCursor | null;
	archived?: boolean | null;
}) {
	const params = new URLSearchParams({
		limit: String(input.limit),
	});
	if (input.cursor) {
		params.set("cursorUpdatedAt", input.cursor.updatedAt);
		params.set("cursorId", input.cursor.id);
	}
	if (input.archived !== undefined && input.archived !== null) {
		params.set("archived", input.archived ? "true" : "false");
	}
	return request<ThreadPage>(`/api/threads?${params.toString()}`);
}

export function createThread(input: {
	cwd: string;
	prompt: string;
	goalMode?: boolean | null;
	name?: string | null;
	model?: string | null;
}) {
	return request<{
		thread: ControlThread | null;
		turn: Turn | null;
		goal: {
			objective: string;
			status: GoalStatus;
			tokenBudget: number | null;
			tokensUsed: number;
		} | null;
	}>("/api/threads", {
		method: "POST",
		body: JSON.stringify(input),
	});
}

export function startTurn(threadId: string, prompt: string) {
	return request<Turn>(`/api/threads/${threadId}/turns`, {
		method: "POST",
		body: JSON.stringify({ prompt }),
	});
}

export function interruptTurn(threadId: string) {
	return request<ControlThread>(`/api/threads/${threadId}/interrupt`, {
		method: "POST",
		body: JSON.stringify({}),
	});
}

export function resumeThread(threadId: string) {
	return request<ControlThread>(`/api/threads/${threadId}/resume`, {
		method: "POST",
		body: JSON.stringify({}),
	});
}

export function forkThread(threadId: string) {
	return request<ControlThread>(`/api/threads/${threadId}/fork`, {
		method: "POST",
		body: JSON.stringify({}),
	});
}

export function compactThread(threadId: string) {
	return request<Turn>(`/api/threads/${threadId}/compact`, {
		method: "POST",
		body: JSON.stringify({}),
	});
}

export function archiveThread(threadId: string) {
	return request<ControlThread>(`/api/threads/${threadId}/archive`, {
		method: "POST",
		body: JSON.stringify({}),
	});
}

export function startGoal(
	threadId: string,
	objective: string,
	tokenBudget?: number | null,
) {
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
		body: JSON.stringify({ objective, tokenBudget: tokenBudget ?? null }),
	});
}

export function setGoalStatus(
	threadId: string,
	status: "active" | "paused" | "complete",
) {
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
		body: JSON.stringify({ status }),
	});
}

export function clearGoal(threadId: string) {
	return request<ControlThread>(`/api/threads/${threadId}/goal`, {
		method: "DELETE",
	});
}

export function restartCodexAppServer() {
	return request<CodexAppServerRestartResponse>(
		"/api/runtime/app-server/restart",
		{
			method: "POST",
			body: JSON.stringify({}),
		},
	);
}

export function getTerminal() {
	return request<TerminalSnapshot>("/api/terminal");
}

export function startTerminal(
	input: { cols?: number | null; rows?: number | null } = {},
) {
	return request<TerminalSnapshot>("/api/terminal/start", {
		method: "POST",
		body: JSON.stringify({
			cols: input.cols ?? null,
			rows: input.rows ?? null,
		}),
	});
}

export function writeTerminalInput(data: string) {
	return request<void>("/api/terminal/input", {
		method: "POST",
		body: JSON.stringify({ data }),
	});
}

export function resizeTerminal(input: {
	cols?: number | null;
	rows?: number | null;
}) {
	return request<TerminalSnapshot>("/api/terminal/resize", {
		method: "POST",
		body: JSON.stringify({
			cols: input.cols ?? null,
			rows: input.rows ?? null,
		}),
	});
}

export function terminateTerminal() {
	return request<TerminalSnapshot>("/api/terminal/terminate", {
		method: "POST",
		body: JSON.stringify({}),
	});
}
