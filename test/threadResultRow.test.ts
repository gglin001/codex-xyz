import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
	ThreadResultRow,
	threadResultSearchText,
} from "../src/client/components/ThreadResultRow.js";
import { buildWorkbenchProjects } from "../src/client/components/workbenchData.js";
import type { ControlThread } from "../src/server/domain.js";

const createdAt = "2026-07-09T00:00:00.000Z";

function thread(overrides: Partial<ControlThread> = {}): ControlThread {
	return {
		id: "thread-1",
		sessionId: "session-1",
		forkedFromId: null,
		parentThreadId: null,
		sourceKind: "app_server",
		agentNickname: null,
		agentRole: null,
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
		contextWindow: null,
		tagScore: null,
		lifecycleState: "active",
		desiredArchived: false,
		remoteArchived: false,
		remoteObservedAt: createdAt,
		remoteUpdatedAt: createdAt,
		localUpdatedAt: createdAt,
		runtimeSeenAt: createdAt,
		runtimeEpoch: 1,
		syncGeneration: 1,
		stateRevision: 1,
		lastOperationError: null,
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

	it("keeps thread runtime status primary and exposes turn result on hover", () => {
		const markup = renderToStaticMarkup(
			createElement(ThreadResultRow, { thread: workbenchThread() }),
		);

		expect(markup).toContain("Idle");
		expect(markup).not.toContain("turn completed");
		expect(markup).toContain("Last turn: Completed");
	});

	it("keeps main thread content searchable", () => {
		const result = workbenchThread();

		expect(threadResultSearchText(result)).toContain(result.name);
		expect(threadResultSearchText(result)).toContain(result.preview);
	});
});
