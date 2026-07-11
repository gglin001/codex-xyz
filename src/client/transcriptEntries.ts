import type { ThreadItem } from "../server/domain.js";

export type TranscriptItemEntry = {
	kind: "item";
	id: string;
	item: ThreadItem;
};

export type TranscriptProcessEntry = {
	kind: "process";
	id: string;
	threadId: string;
	turnId: string | null;
	items: ThreadItem[];
	createdAt: string;
	updatedAt: string;
};

export type TranscriptEntry = TranscriptItemEntry | TranscriptProcessEntry;

const processSourceTypes = new Set([
	"reasoning",
	"turnPlan",
	"mcpToolCall",
	"dynamicToolCall",
	"webSearch",
]);

function itemSourceType(item: ThreadItem) {
	return typeof item.data.sourceType === "string" ? item.data.sourceType : null;
}

function agentPhase(item: ThreadItem) {
	return typeof item.data.phase === "string" ? item.data.phase : null;
}

function isLocalSubmissionError(item: ThreadItem) {
	return item.data.localSubmissionError === true;
}

function turnKey(item: ThreadItem) {
	return item.turnId ?? `thread:${item.threadId}`;
}

function directUnphasedAgentIds(items: ThreadItem[]) {
	const finalTurns = new Set<string>();
	const latestUnphasedAgentByTurn = new Map<string, string>();

	for (const item of items) {
		if (item.type !== "agent") {
			continue;
		}

		const phase = agentPhase(item);
		if (phase === "final_answer") {
			finalTurns.add(turnKey(item));
		} else if (!phase) {
			latestUnphasedAgentByTurn.set(turnKey(item), item.id);
		}
	}

	const directIds = new Set<string>();
	for (const [key, itemId] of latestUnphasedAgentByTurn) {
		if (!finalTurns.has(key)) {
			directIds.add(itemId);
		}
	}
	return directIds;
}

export function isTranscriptProcessItem(
	item: ThreadItem,
	directAgentIds: Set<string>,
) {
	if (item.type === "user" || item.type === "file") {
		return false;
	}
	if (isLocalSubmissionError(item)) {
		return false;
	}

	if (item.type === "agent") {
		const phase = agentPhase(item);
		if (phase === "final_answer") {
			return false;
		}
		if (phase === "commentary") {
			return true;
		}
		return !directAgentIds.has(item.id);
	}

	const sourceType = itemSourceType(item);
	if (
		sourceType === "collabAgentToolCall" ||
		sourceType === "subAgentActivity"
	) {
		return false;
	}
	return (
		item.type === "command" ||
		item.type === "plan" ||
		item.type === "system" ||
		processSourceTypes.has(sourceType ?? "")
	);
}

function processEntry(items: ThreadItem[]): TranscriptProcessEntry {
	const first = items[0];
	const last = items[items.length - 1];
	return {
		kind: "process",
		id: `process:${first.turnId ?? first.threadId}:${first.id}`,
		threadId: first.threadId,
		turnId: first.turnId,
		items,
		createdAt: first.createdAt,
		updatedAt: last.createdAt,
	};
}

export function getTranscriptEntries(items: ThreadItem[]): TranscriptEntry[] {
	const directAgentIds = directUnphasedAgentIds(items);
	const entries: TranscriptEntry[] = [];
	let processItems: ThreadItem[] = [];

	function flushProcessItems() {
		if (processItems.length === 0) {
			return;
		}
		entries.push(processEntry(processItems));
		processItems = [];
	}

	for (const item of items) {
		if (isTranscriptProcessItem(item, directAgentIds)) {
			processItems.push(item);
			continue;
		}

		flushProcessItems();
		entries.push({
			kind: "item",
			id: `item:${item.id}`,
			item,
		});
	}

	flushProcessItems();
	return entries;
}
