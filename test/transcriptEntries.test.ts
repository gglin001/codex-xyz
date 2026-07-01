import { describe, expect, it } from "vitest";
import { getTranscriptEntries } from "../src/client/transcriptEntries.js";
import type { ThreadItem } from "../src/server/domain.js";

const createdAt = "2026-06-13T00:00:00.000Z";

function item(overrides: Partial<ThreadItem> = {}): ThreadItem {
	return {
		id: "item-1",
		threadId: "thread-1",
		turnId: "turn-1",
		type: "agent",
		text: "Working",
		data: {},
		createdAt,
		...overrides,
	};
}

describe("transcript entries", () => {
	it("keeps user and final answer visible while grouping intermediate process output", () => {
		const entries = getTranscriptEntries([
			item({ id: "user", type: "user", text: "Fix the UI" }),
			item({
				id: "reasoning",
				type: "plan",
				text: "Need to inspect transcript rendering",
				data: { sourceType: "reasoning" },
			}),
			item({
				id: "command",
				type: "command",
				text: "$ pnpm test\npassed",
				data: { command: "pnpm test", status: "completed", exitCode: 0 },
			}),
			item({
				id: "final",
				type: "agent",
				text: "Implemented.",
				data: { phase: "final_answer" },
			}),
		]);

		expect(entries).toHaveLength(3);
		expect(entries[0]).toMatchObject({ kind: "item", item: { id: "user" } });
		expect(entries[1]).toMatchObject({
			kind: "process",
			items: [{ id: "reasoning" }, { id: "command" }],
		});
		expect(entries[2]).toMatchObject({ kind: "item", item: { id: "final" } });
	});

	it("treats commentary agent messages as process details", () => {
		const entries = getTranscriptEntries([
			item({ id: "user", type: "user", text: "Continue" }),
			item({
				id: "commentary",
				type: "agent",
				text: "I will inspect the files.",
				data: { phase: "commentary" },
			}),
			item({
				id: "final",
				type: "agent",
				text: "Done.",
				data: { phase: "final_answer" },
			}),
		]);

		expect(entries.map((entry) => entry.kind)).toEqual([
			"item",
			"process",
			"item",
		]);
		expect(entries[1]).toMatchObject({
			kind: "process",
			items: [{ id: "commentary" }],
		});
	});

	it("uses the last unphased agent message in a turn as the visible answer for legacy data", () => {
		const entries = getTranscriptEntries([
			item({ id: "user", type: "user", text: "Run tests" }),
			item({ id: "progress", type: "agent", text: "Checking scripts" }),
			item({ id: "command", type: "command", text: "$ pnpm test\npassed" }),
			item({ id: "answer", type: "agent", text: "Tests pass." }),
		]);

		expect(entries).toHaveLength(3);
		expect(entries[1]).toMatchObject({
			kind: "process",
			items: [{ id: "progress" }, { id: "command" }],
		});
		expect(entries[2]).toMatchObject({ kind: "item", item: { id: "answer" } });
	});

	it("keeps steering input on the main timeline instead of burying it in process details", () => {
		const entries = getTranscriptEntries([
			item({ id: "user", type: "user", text: "Keep working" }),
			item({ id: "command-1", type: "command", text: "$ pnpm test\nrunning" }),
			item({
				id: "steer",
				type: "user",
				text: "Focus on mobile.",
				data: { steer: true },
			}),
			item({ id: "command-2", type: "command", text: "$ pnpm test\npassed" }),
			item({
				id: "final",
				type: "agent",
				text: "Mobile fixed.",
				data: { phase: "final_answer" },
			}),
		]);

		expect(entries).toHaveLength(5);
		expect(entries[1]).toMatchObject({
			kind: "process",
			items: [{ id: "command-1" }],
		});
		expect(entries[2]).toMatchObject({ kind: "item", item: { id: "steer" } });
		expect(entries[3]).toMatchObject({
			kind: "process",
			items: [{ id: "command-2" }],
		});
	});

	it("keeps local submission errors on the main timeline", () => {
		const entries = getTranscriptEntries([
			item({ id: "user", type: "user", text: "Start a thread" }),
			item({
				id: "submit-error",
				type: "system",
				text: "app-server request timed out",
				data: { localSubmissionError: true },
			}),
		]);

		expect(entries).toHaveLength(2);
		expect(entries[0]).toMatchObject({ kind: "item", item: { id: "user" } });
		expect(entries[1]).toMatchObject({
			kind: "item",
			item: { id: "submit-error" },
		});
	});
});
