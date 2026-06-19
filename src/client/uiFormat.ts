import type { ThreadItem } from "../server/domain.js";

export function statusLabel(status: string) {
  return status.replace(/_/g, " ");
}

const timeFormatter = new Intl.DateTimeFormat(undefined, {
  hour: "2-digit",
  hourCycle: "h23",
  minute: "2-digit"
});

const dateTimeFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  hourCycle: "h23",
  minute: "2-digit"
});

const standardTokenFormatter = new Intl.NumberFormat(undefined, {
  notation: "standard"
});

const compactTokenFormatter = new Intl.NumberFormat(undefined, {
  notation: "compact"
});

export function formatTime(value: string) {
  return timeFormatter.format(new Date(value));
}

export function formatDateTime(value: string) {
  return dateTimeFormatter.format(new Date(value));
}

export function formatTokens(value: number | null | undefined) {
  if (!value) {
    return "0";
  }
  return (value >= 100_000 ? compactTokenFormatter : standardTokenFormatter).format(value);
}

export function shortId(value: string) {
  return value.slice(0, 8);
}

export function itemTitle(item: ThreadItem) {
  const sourceType = typeof item.data.sourceType === "string" ? item.data.sourceType : null;
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
