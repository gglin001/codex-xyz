import type { ThreadRuntimeStatus, TurnStatus } from "../domain.js";
import {
	type AdapterEvent,
	type AdapterGoal,
	type AdapterThread,
	AdapterThreadNotFoundError,
	type AdapterTokenUsage,
	type AdapterTurn,
} from "./adapter.js";

export type JsonRpcMessage = {
	id?: number | string;
	method?: string;
	params?: unknown;
	result?: unknown;
	error?: unknown;
};

export type AppServerDebugLogLevel = 0 | 1 | 2 | 3;

export const yoloThreadOptions = {
	approvalPolicy: "never",
	sandbox: "danger-full-access",
} as const;

export const yoloTurnOptions = {
	approvalPolicy: "never",
	sandboxPolicy: { type: "dangerFullAccess" },
} as const;

export const appServerInitializeParams = {
	clientInfo: {
		name: "coz",
		title: "coz",
		version: "0.1.0",
	},
	capabilities: {
		experimentalApi: true,
		requestAttestation: false,
	},
} as const;

const highVolumeDebugMethods = new Set([
	"command/exec/outputDelta",
	"item/agentMessage/delta",
	"item/commandExecution/outputDelta",
	"item/fileChange/outputDelta",
	"item/plan/delta",
	"item/reasoning/summaryTextDelta",
	"item/reasoning/textDelta",
	"process/outputDelta",
	"thread/realtime/outputAudio/delta",
	"thread/realtime/transcript/delta",
]);

export function asRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === "object"
		? (value as Record<string, unknown>)
		: {};
}

export function clampDebugLogLevel(value: unknown): AppServerDebugLogLevel {
	const level =
		typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : 0;
	return Math.min(3, Math.max(0, level)) as AppServerDebugLogLevel;
}

function debugMessageMethod(record: Record<string, unknown>) {
	const message = asRecord(record.message);
	return typeof message.method === "string" ? message.method : null;
}

export function debugRecordLevel(
	record: Record<string, unknown>,
): AppServerDebugLogLevel {
	if (record.event === "message") {
		if (record.parsed === false) {
			return 1;
		}
		const method = debugMessageMethod(record);
		return method && highVolumeDebugMethods.has(method) ? 3 : 2;
	}
	return 1;
}

export function inputText(text: string) {
	return [{ type: "text", text, text_elements: [] }];
}

function textFromUserInput(value: unknown) {
	const entries = Array.isArray(value) ? value : [];
	const parts = entries.map((entry) => {
		const item = asRecord(entry);
		if (item.type === "text") {
			return typeof item.text === "string" ? item.text : "";
		}
		if (item.type === "image") {
			return `[image] ${String(item.url ?? "")}`.trim();
		}
		if (item.type === "localImage") {
			return `[image] ${String(item.path ?? "")}`.trim();
		}
		if (item.type === "skill") {
			return `[skill] ${String(item.name ?? "")}`.trim();
		}
		if (item.type === "mention") {
			return `[mention] ${String(item.name ?? item.path ?? "")}`.trim();
		}
		return "";
	});
	return parts.filter(Boolean).join("\n");
}

function fileChangeSummary(changes: unknown) {
	if (!Array.isArray(changes)) {
		return "";
	}
	return changes
		.map((change) => {
			const record = asRecord(change);
			const kind = asRecord(record.kind);
			const path = String(record.path ?? "");
			const action = typeof kind.type === "string" ? kind.type : "update";
			const target = kind.move_path
				? `${path} -> ${String(kind.move_path)}`
				: path;
			return `${action}: ${target}`;
		})
		.filter(Boolean)
		.join("\n");
}

function fileChangeText(changes: unknown) {
	if (!Array.isArray(changes)) {
		return "";
	}
	const sections = changes.map((change) => {
		const record = asRecord(change);
		const summary = fileChangeSummary([record]);
		const diff =
			typeof record.diff === "string" && record.diff ? `\n${record.diff}` : "";
		return `${summary}${diff}`.trim();
	});
	return sections.filter(Boolean).join("\n\n");
}

function planText(explanation: unknown, plan: unknown) {
	const heading =
		typeof explanation === "string" && explanation.trim()
			? `${explanation.trim()}\n`
			: "";
	const steps = Array.isArray(plan)
		? plan
				.map((step, index) => {
					const record = asRecord(step);
					const status =
						typeof record.status === "string" ? record.status : "pending";
					return `${index + 1}. [${status}] ${String(record.step ?? "")}`.trim();
				})
				.filter(Boolean)
		: [];
	return `${heading}${steps.join("\n")}`.trim();
}

function formatCommandExecution(item: Record<string, unknown>) {
	const command = String(item.command ?? "");
	const status = String(item.status ?? "inProgress");
	const output =
		typeof item.aggregatedOutput === "string" ? item.aggregatedOutput : "";
	const exitCode = typeof item.exitCode === "number" ? item.exitCode : null;
	let text = `$ ${command}\n${output}`;
	if (status !== "inProgress") {
		const exit = exitCode === null ? status : `${status}, exit ${exitCode}`;
		text = `${text.endsWith("\n") ? text : `${text}\n`}[${exit}]`;
	}
	return text;
}

export function normalizeThreadItem(value: unknown) {
	const item = asRecord(value);
	const id = String(item.id ?? "");
	const itemType = String(item.type ?? "system");
	if (itemType === "userMessage") {
		return {
			itemId: id,
			itemType: "user" as const,
			text: textFromUserInput(item.content),
			data: {
				sourceType: itemType,
				clientId: item.clientId ?? null,
				raw: item,
			},
		};
	}
	if (itemType === "agentMessage") {
		return {
			itemId: id,
			itemType: "agent" as const,
			text: String(item.text ?? ""),
			data: { sourceType: itemType, phase: item.phase ?? null, raw: item },
		};
	}
	if (itemType === "plan") {
		return {
			itemId: id,
			itemType: "plan" as const,
			text: String(item.text ?? ""),
			data: { sourceType: itemType, raw: item },
		};
	}
	if (itemType === "commandExecution") {
		return {
			itemId: id,
			itemType: "command" as const,
			text: formatCommandExecution(item),
			data: {
				sourceType: itemType,
				command: item.command ?? null,
				cwd: item.cwd ?? null,
				status: item.status ?? null,
				source: item.source ?? null,
				exitCode: item.exitCode ?? null,
				durationMs: item.durationMs ?? null,
				raw: item,
			},
		};
	}
	if (itemType === "fileChange") {
		return {
			itemId: id,
			itemType: "file" as const,
			text: fileChangeText(item.changes) || fileChangeSummary(item.changes),
			data: {
				sourceType: itemType,
				status: item.status ?? null,
				changes: Array.isArray(item.changes) ? item.changes : [],
				raw: item,
			},
		};
	}
	if (itemType === "reasoning") {
		const summary = Array.isArray(item.summary) ? item.summary.join("\n") : "";
		const content = Array.isArray(item.content) ? item.content.join("\n") : "";
		return {
			itemId: id,
			itemType: "plan" as const,
			text: [summary, content].filter(Boolean).join("\n\n"),
			data: { sourceType: itemType, raw: item },
		};
	}
	if (itemType === "mcpToolCall") {
		return {
			itemId: id,
			itemType: "system" as const,
			text: `${String(item.server ?? "mcp")}.${String(item.tool ?? "tool")} ${String(item.status ?? "")}`.trim(),
			data: { sourceType: itemType, raw: item },
		};
	}
	if (itemType === "dynamicToolCall") {
		return {
			itemId: id,
			itemType: "system" as const,
			text: `${String(item.namespace ?? "tool")}.${String(item.tool ?? "call")} ${String(item.status ?? "")}`.trim(),
			data: { sourceType: itemType, raw: item },
		};
	}
	if (itemType === "webSearch") {
		return {
			itemId: id,
			itemType: "system" as const,
			text: `Web search: ${String(item.query ?? "")}`.trim(),
			data: { sourceType: itemType, raw: item },
		};
	}
	return {
		itemId: id,
		itemType: "system" as const,
		text: itemType,
		data: { sourceType: itemType, raw: item },
	};
}

export function normalizeThreadId(value: unknown) {
	const id = String(value);
	const uuid =
		"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";
	const prefixed = id.match(new RegExp(`^thread_(${uuid})$`));
	const urn = id.match(new RegExp(`^urn:uuid:(${uuid})$`, "i"));
	return (prefixed?.[1] ?? urn?.[1] ?? id).toLowerCase();
}

export function normalizeThreadRuntimeStatus(
	value: unknown,
): ThreadRuntimeStatus {
	const status = asRecord(value);
	if (status.type === "active") {
		return "active";
	}
	if (status.type === "idle") {
		return "idle";
	}
	if (status.type === "systemError") {
		return "system_error";
	}
	if (status.type === "notLoaded") {
		return "not_loaded";
	}
	const text =
		typeof value === "string"
			? value
			: typeof status.status === "string"
				? status.status
				: "";
	if (
		text === "idle" ||
		text === "active" ||
		text === "not_loaded" ||
		text === "system_error"
	) {
		return text;
	}
	throw new Error(`Unknown app-server thread status: ${JSON.stringify(value)}`);
}

export function normalizeTurnStatus(value: unknown): TurnStatus {
	const status = String(value ?? "inProgress");
	if (status === "inProgress" || status === "in_progress") {
		return "in_progress";
	}
	if (
		status === "completed" ||
		status === "interrupted" ||
		status === "failed"
	) {
		return status;
	}
	throw new Error(`Unknown app-server turn status: ${JSON.stringify(value)}`);
}

function normalizeOptionalTurnId(value: unknown) {
	return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function normalizeUnixTimestamp(value: unknown) {
	if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
		return null;
	}
	const milliseconds = value > 10_000_000_000 ? value : value * 1000;
	return new Date(milliseconds).toISOString();
}

export function normalizeThread(
	value: unknown,
	model?: unknown,
): AdapterThread {
	const thread = asRecord(value);
	const id = normalizeThreadId(thread.id);
	const status = asRecord(thread.status);
	return {
		id,
		sessionId: normalizeThreadId(thread.sessionId ?? id),
		forkedFromId:
			typeof thread.forkedFromId === "string"
				? normalizeThreadId(thread.forkedFromId)
				: null,
		preview: String(thread.preview ?? ""),
		cwd: String(thread.cwd ?? process.cwd()),
		model:
			typeof thread.model === "string"
				? thread.model
				: typeof model === "string"
					? model
					: null,
		status: normalizeThreadRuntimeStatus(thread.status),
		activeTurnId:
			normalizeOptionalTurnId(thread.activeTurnId) ??
			normalizeOptionalTurnId(status.activeTurnId) ??
			normalizeOptionalTurnId(status.turnId),
		updatedAt: normalizeUnixTimestamp(thread.updatedAt),
	};
}

export function normalizeTurn(value: unknown): AdapterTurn {
	const turn = asRecord(value);
	return {
		id: String(turn.id),
		status: normalizeTurnStatus(turn.status),
	};
}

export function extractThreadId(params: Record<string, unknown>) {
	return typeof params.threadId === "string"
		? normalizeThreadId(params.threadId)
		: null;
}

export function extractTurnId(params: Record<string, unknown>) {
	return typeof params.turnId === "string" ? params.turnId : null;
}

export function requestError(error: unknown, params: unknown) {
	const payload = asRecord(error);
	const message =
		typeof payload.message === "string"
			? payload.message
			: JSON.stringify(error);
	if (/thread not found|no rollout found for thread id/i.test(message)) {
		const match =
			message.match(/thread not found:\s*([^\s"}]+)/i) ??
			message.match(/no rollout found for thread id\s+([^\s"}]+)/i);
		const threadId = match?.[1] ?? extractThreadId(asRecord(params));
		if (threadId) {
			return new AdapterThreadNotFoundError(
				normalizeThreadId(threadId),
				message,
			);
		}
	}
	return new Error(message);
}

export function normalizeTokenUsage(value: unknown): AdapterTokenUsage {
	const usage = asRecord(value);
	const total = asRecord(usage.total);
	return {
		totalTokens: typeof total.totalTokens === "number" ? total.totalTokens : 0,
		inputTokens: typeof total.inputTokens === "number" ? total.inputTokens : 0,
		cachedInputTokens:
			typeof total.cachedInputTokens === "number" ? total.cachedInputTokens : 0,
		outputTokens:
			typeof total.outputTokens === "number" ? total.outputTokens : 0,
		reasoningOutputTokens:
			typeof total.reasoningOutputTokens === "number"
				? total.reasoningOutputTokens
				: 0,
		modelContextWindow:
			typeof usage.modelContextWindow === "number"
				? usage.modelContextWindow
				: null,
	};
}

export function normalizeGoal(value: unknown): AdapterGoal {
	const goal = asRecord(value);
	const status = String(goal.status ?? "active");
	return {
		objective: String(goal.objective ?? ""),
		status:
			status === "complete"
				? "complete"
				: status === "paused"
					? "paused"
					: status === "blocked"
						? "blocked"
						: status === "usageLimited"
							? "usage_limited"
							: status === "budgetLimited"
								? "budget_limited"
								: "in_progress",
		tokenBudget: typeof goal.tokenBudget === "number" ? goal.tokenBudget : null,
		tokensUsed: typeof goal.tokensUsed === "number" ? goal.tokensUsed : 0,
	};
}

export function projectTurnStartedNotification(
	params: Record<string, unknown>,
	prompt: string | null,
): AdapterEvent | null {
	const threadId = extractThreadId(params);
	if (!threadId) {
		return null;
	}
	const turn = normalizeTurn(asRecord(params.turn));
	return {
		type: "turn.started",
		threadId,
		turnId: turn.id,
		prompt: prompt ?? "",
	};
}

export function projectAppServerNotification(
	method: string,
	params: Record<string, unknown>,
): AdapterEvent | null {
	const threadId = extractThreadId(params);
	const turnId = extractTurnId(params);

	if (method === "item/agentMessage/delta" && threadId && turnId) {
		return {
			type: "item.delta",
			threadId,
			turnId,
			itemId: String(params.itemId),
			delta: String(params.delta ?? ""),
			itemType: "agent",
		};
	}
	if (method === "item/plan/delta" && threadId && turnId) {
		return {
			type: "item.delta",
			threadId,
			turnId,
			itemId: String(params.itemId),
			delta: String(params.delta ?? ""),
			itemType: "plan",
		};
	}
	if (method === "item/commandExecution/outputDelta" && threadId && turnId) {
		return {
			type: "item.delta",
			threadId,
			turnId,
			itemId: String(params.itemId),
			delta: String(params.delta ?? ""),
			itemType: "command",
		};
	}
	if (method === "item/fileChange/outputDelta" && threadId && turnId) {
		return {
			type: "item.delta",
			threadId,
			turnId,
			itemId: String(params.itemId),
			delta: String(params.delta ?? ""),
			itemType: "file",
		};
	}
	if (
		(method === "item/started" || method === "item/completed") &&
		threadId &&
		turnId
	) {
		const item = normalizeThreadItem(params.item);
		if (item.itemId) {
			return {
				type: method === "item/started" ? "item.created" : "item.updated",
				threadId,
				turnId,
				itemId: item.itemId,
				itemType: item.itemType,
				text: item.text,
				data: item.data,
			};
		}
	}
	if (method === "item/fileChange/patchUpdated" && threadId && turnId) {
		const itemId = String(params.itemId ?? "");
		if (itemId) {
			return {
				type: "item.updated",
				threadId,
				turnId,
				itemId,
				itemType: "file",
				text:
					fileChangeText(params.changes) || fileChangeSummary(params.changes),
				data: {
					sourceType: "fileChange",
					changes: Array.isArray(params.changes) ? params.changes : [],
					patchUpdated: true,
				},
			};
		}
	}
	if (method === "turn/plan/updated" && threadId && turnId) {
		return {
			type: "item.updated",
			threadId,
			turnId,
			itemId: `plan_${turnId}`,
			itemType: "plan",
			text: planText(params.explanation, params.plan),
			data: {
				sourceType: "turnPlan",
				explanation: params.explanation ?? null,
				plan: Array.isArray(params.plan) ? params.plan : [],
			},
		};
	}
	if (method === "turn/completed" && threadId) {
		const turnPayload = asRecord(params.turn);
		const turn = normalizeTurn(turnPayload);
		const durationMs = turnPayload.durationMs;
		return {
			type: "turn.status",
			threadId,
			turnId: turn.id,
			status: turn.status,
			durationMs: typeof durationMs === "number" ? durationMs : null,
		};
	}
	if (method === "thread/goal/updated" && threadId) {
		return {
			type: "thread.goal",
			threadId,
			turnId,
			goal: normalizeGoal(asRecord(params.goal)),
		};
	}
	if (method === "thread/goal/cleared" && threadId) {
		return {
			type: "thread.goal",
			threadId,
			turnId: null,
			goal: null,
		};
	}
	if (method === "thread/name/updated" && threadId) {
		return {
			type: "thread.renamed",
			threadId,
			title: typeof params.threadName === "string" ? params.threadName : null,
		};
	}
	if (method === "thread/tokenUsage/updated" && threadId) {
		return {
			type: "thread.token_usage",
			threadId,
			turnId,
			usage: normalizeTokenUsage(params.tokenUsage),
		};
	}
	if (method === "thread/status/changed" && threadId) {
		return {
			type: "thread.status",
			threadId,
			status: normalizeThreadRuntimeStatus(params.status),
		};
	}
	return null;
}

export function isYoloApprovalRequest(method: string | undefined) {
	return (
		method === "item/commandExecution/requestApproval" ||
		method === "item/fileChange/requestApproval" ||
		method === "item/permissions/requestApproval"
	);
}

export function yoloApprovalResponse(
	method: string | undefined,
	params: Record<string, unknown>,
) {
	if (method === "item/permissions/requestApproval") {
		return {
			permissions: asRecord(params.permissions),
			scope: "session",
		};
	}

	return {
		decision: "accept",
	};
}
