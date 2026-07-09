import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ThreadResultRow } from "../src/client/components/ThreadResultRow.js";
import { buildWorkbenchProjects } from "../src/client/components/workbenchData.js";
import type { ControlThread } from "../src/server/domain.js";

const createdAt = "2026-07-09T00:00:00.000Z";

function thread(overrides: Partial<ControlThread> = {}): ControlThread {
	return {
		id: "thread-1",
		sessionId: "session-1",
		forkedFromId: null,
		name: "Long session title that should remain horizontally scrollable",
		preview: "Long session preview that should remain horizontally scrollable",
		cwd: "/work/codex-xyz",
		model: "test-model",
		status: "idle",
		activeTurnId: null,
		lastTurnStatus: "completed",
		goalObjective: null,
		goalStatus: null,
		goalTokenBudget: null,
		tokensUsed: 1234,
		tagScore: null,
		archivedAt: null,
		createdAt,
		updatedAt: createdAt,
		...overrides,
	};
}

function workbenchThread(overrides: Partial<ControlThread> = {}) {
	const projects = buildWorkbenchProjects(
		[thread(overrides)],
		"/work/codex-xyz",
		{
			now: new Date(createdAt),
		},
	);
	const result = projects[0]?.threads[0];
	if (!result) {
		throw new Error("Expected buildWorkbenchProjects to create a thread");
	}
	return result;
}

describe("ThreadResultRow", () => {
	it("keeps session list text horizontally scrollable by default", () => {
		const markup = renderToStaticMarkup(
			createElement(ThreadResultRow, { thread: workbenchThread() }),
		);

		expect(markup).toContain("scrollable-truncate");
		expect(markup).toContain("scrollable-row");
		expect(markup).not.toContain("mobile-static-scroll");
	});

	it("can still opt into static mobile text", () => {
		const markup = renderToStaticMarkup(
			createElement(ThreadResultRow, {
				thread: workbenchThread(),
				mobileStaticText: true,
			}),
		);

		expect(markup).toContain("mobile-static-scroll");
	});
});
