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

const standardTokenFormatter = new Intl.NumberFormat(undefined, {
	notation: "standard",
});

const compactTokenFormatter = new Intl.NumberFormat(undefined, {
	notation: "compact",
});

export function formatTime(value: string) {
	return formatFullDateTime(value);
}

export function formatDateTime(value: string) {
	return formatFullDateTime(value);
}

export function formatFullDateTime(value: string) {
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) {
		return value;
	}
	const month = shortMonthNames[date.getMonth()];
	const year = date.getFullYear();
	const day = date.getDate();
	const hour = String(date.getHours()).padStart(2, "0");
	const minute = String(date.getMinutes()).padStart(2, "0");
	return `${month} ${day}, ${year} ${hour}:${minute}`;
}

export function formatDate(value: string) {
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) {
		return value;
	}
	const month = shortMonthNames[date.getMonth()];
	return `${month} ${date.getDate()}, ${date.getFullYear()}`;
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
