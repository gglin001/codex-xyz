import type { ThreadItem } from "../server/domain.js";

export function statusLabel(status: string) {
	return status.replace(/_/g, " ");
}

const shortMonthNames = [
	"Jan",
	"Feb",
	"Mar",
	"Apr",
	"May",
	"Jun",
	"Jul",
	"Aug",
	"Sep",
	"Oct",
	"Nov",
	"Dec",
] as const;

export type DateTimeFormatMode = "utc" | "local";

const standardTokenFormatter = new Intl.NumberFormat("en-US", {
	notation: "standard",
});

const compactTokenFormatter = new Intl.NumberFormat("en-US", {
	notation: "compact",
});

export function formatTime(
	value: string,
	dateTimeFormatMode: DateTimeFormatMode = "utc",
) {
	return formatFullDateTime(value, dateTimeFormatMode);
}

export function formatDateTime(
	value: string,
	dateTimeFormatMode: DateTimeFormatMode = "utc",
) {
	return formatFullDateTime(value, dateTimeFormatMode);
}

export function formatFullDateTime(
	value: string,
	dateTimeFormatMode: DateTimeFormatMode = "utc",
) {
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) {
		return value;
	}
	const monthIndex =
		dateTimeFormatMode === "utc" ? date.getUTCMonth() : date.getMonth();
	const month = shortMonthNames[monthIndex];
	const year =
		dateTimeFormatMode === "utc" ? date.getUTCFullYear() : date.getFullYear();
	const day = dateTimeFormatMode === "utc" ? date.getUTCDate() : date.getDate();
	const hour = String(
		dateTimeFormatMode === "utc" ? date.getUTCHours() : date.getHours(),
	).padStart(2, "0");
	const minute = String(
		dateTimeFormatMode === "utc" ? date.getUTCMinutes() : date.getMinutes(),
	).padStart(2, "0");
	return `${month} ${day}, ${year} ${hour}:${minute}`;
}

export function formatDate(
	value: string,
	dateTimeFormatMode: DateTimeFormatMode = "utc",
) {
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) {
		return value;
	}
	const monthIndex =
		dateTimeFormatMode === "utc" ? date.getUTCMonth() : date.getMonth();
	const month = shortMonthNames[monthIndex];
	const day = dateTimeFormatMode === "utc" ? date.getUTCDate() : date.getDate();
	const year =
		dateTimeFormatMode === "utc" ? date.getUTCFullYear() : date.getFullYear();
	return `${month} ${day}, ${year}`;
}

export function formatTokens(value: number | null | undefined) {
	if (!value) {
		return "0";
	}
	return (
		value >= 100_000 ? compactTokenFormatter : standardTokenFormatter
	).format(value);
}

export function shortId(value: string) {
	return value.slice(0, 8);
}

export function itemTitle(item: ThreadItem) {
	const sourceType =
		typeof item.data.sourceType === "string" ? item.data.sourceType : null;
	if (sourceType === "reasoning") {
		return "Reasoning";
	}
	if (sourceType === "mcpToolCall") {
		return "MCP tool";
	}
	if (sourceType === "dynamicToolCall") {
		return "Tool";
	}
	if (sourceType === "webSearch") {
		return "Web search";
	}
	if (sourceType === "collabAgentToolCall") {
		return "Agent collaboration";
	}
	if (sourceType === "subAgentActivity") {
		return "Subagent activity";
	}
	if (item.type === "agent") {
		return "Codex";
	}
	if (item.type === "user") {
		if (item.data.steer === true) {
			return "Steer";
		}
		return "User";
	}
	if (item.type === "plan") {
		return "Plan";
	}
	if (item.type === "command") {
		return "Command";
	}
	if (item.type === "file") {
		return "Files";
	}
	return "System";
}
