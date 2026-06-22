import { describe, expect, it } from "vitest";
import {
	choosePreferredThreadId,
	queryMatchesArchivedSessions,
	shouldLoadThreadSelection,
	shouldSelectActionResult,
} from "../src/client/threadSelection.js";

const threads = [{ id: "thread-a" }, { id: "thread-b" }];

describe("thread selection", () => {
	it("prefers an explicit requested thread when it exists", () => {
		expect(
			choosePreferredThreadId(threads, {
				currentThreadId: "thread-a",
				requestedThreadId: "thread-b",
				preferRequestedThread: true,
			}),
		).toBe("thread-b");
	});

	it("keeps the current selection for non-explicit refreshes", () => {
		expect(
			choosePreferredThreadId(threads, {
				currentThreadId: "thread-b",
				requestedThreadId: "thread-a",
				preferRequestedThread: false,
			}),
		).toBe("thread-b");
	});

	it("falls back to the requested thread when the current selection is gone", () => {
		expect(
			choosePreferredThreadId(threads, {
				currentThreadId: "missing",
				requestedThreadId: "thread-a",
				preferRequestedThread: false,
			}),
		).toBe("thread-a");
	});

	it("falls back to the first thread or null", () => {
		expect(
			choosePreferredThreadId(threads, {
				currentThreadId: "missing",
				requestedThreadId: "also-missing",
				preferRequestedThread: true,
			}),
		).toBe("thread-a");
		expect(
			choosePreferredThreadId([], {
				currentThreadId: "missing",
				requestedThreadId: "also-missing",
				preferRequestedThread: true,
			}),
		).toBeNull();
	});

	it("can leave the selection empty instead of falling back to the first thread", () => {
		expect(
			choosePreferredThreadId(threads, {
				currentThreadId: null,
				requestedThreadId: null,
				preferRequestedThread: false,
				allowFallbackSelection: false,
			}),
		).toBeNull();
	});
});

describe("action result selection", () => {
	it("selects string results only when selection is requested and unchanged", () => {
		expect(
			shouldSelectActionResult("thread-a", {
				selectResult: true,
				actionSelectionSeq: 1,
				currentSelectionSeq: 1,
			}),
		).toBe(true);
	});

	it("does not select action results after a manual selection", () => {
		expect(
			shouldSelectActionResult("thread-a", {
				selectResult: true,
				actionSelectionSeq: 1,
				currentSelectionSeq: 2,
			}),
		).toBe(false);
	});

	it("does not select missing, non-string, or non-requested results", () => {
		expect(
			shouldSelectActionResult("thread-a", {
				selectResult: false,
				actionSelectionSeq: 1,
				currentSelectionSeq: 1,
			}),
		).toBe(false);
		expect(
			shouldSelectActionResult(undefined, {
				selectResult: true,
				actionSelectionSeq: 1,
				currentSelectionSeq: 1,
			}),
		).toBe(false);
		expect(
			shouldSelectActionResult(
				{ id: "thread-a" },
				{
					selectResult: true,
					actionSelectionSeq: 1,
					currentSelectionSeq: 1,
				},
			),
		).toBe(false);
	});
});

describe("thread detail selection loading", () => {
	it("skips loading when the selected thread detail is already current", () => {
		expect(
			shouldLoadThreadSelection("thread-a", {
				currentThreadId: "thread-a",
				currentDetailThreadId: "thread-a",
			}),
		).toBe(false);
	});

	it("loads when selecting a different thread", () => {
		expect(
			shouldLoadThreadSelection("thread-b", {
				currentThreadId: "thread-a",
				currentDetailThreadId: "thread-a",
			}),
		).toBe(true);
	});

	it("loads when the current thread detail is not available yet", () => {
		expect(
			shouldLoadThreadSelection("thread-a", {
				currentThreadId: "thread-a",
				currentDetailThreadId: null,
			}),
		).toBe(true);
	});
});

describe("archived session search matching", () => {
	it("matches archive status aliases from short prefixes", () => {
		expect(queryMatchesArchivedSessions("ar")).toBe(true);
		expect(queryMatchesArchivedSessions("arch")).toBe(true);
		expect(queryMatchesArchivedSessions("archive")).toBe(true);
		expect(queryMatchesArchivedSessions("archived")).toBe(true);
	});

	it("matches archive aliases inside multi-word queries", () => {
		expect(queryMatchesArchivedSessions("project arch")).toBe(true);
		expect(queryMatchesArchivedSessions("foo archived")).toBe(true);
	});

	it("does not match unrelated or one-letter queries", () => {
		expect(queryMatchesArchivedSessions("a")).toBe(false);
		expect(queryMatchesArchivedSessions("running")).toBe(false);
		expect(queryMatchesArchivedSessions("")).toBe(false);
	});
});
