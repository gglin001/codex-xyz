import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { StatusIndicator } from "../src/client/components/statusIndicator.js";
import {
	statusPresentation,
	threadStatusTooltip,
} from "../src/client/statusPresentation.js";
import type { ThreadDisplayStatus, TurnStatus } from "../src/server/domain.js";
import { threadDisplayStatus } from "../src/server/domain.js";

describe("status presentation", () => {
	it.each<[ThreadDisplayStatus | TurnStatus, string, string, string]>([
		["active", "Running", "running", "running"],
		["idle", "Idle", "neutral", "idle"],
		["not_loaded", "Unloaded", "neutral", "unloaded"],
		["system_error", "Error", "error", "error"],
		["archived", "Archived", "neutral", "archive"],
		["in_progress", "Running", "running", "running"],
		["completed", "Completed", "completed", "check"],
		["interrupted", "Interrupted", "stale", "stop"],
		["failed", "Failed", "error", "error"],
	])("maps %s to a unified descriptor", (status, label, tone, icon) => {
		expect(statusPresentation(status)).toMatchObject({ label, tone, icon });
	});

	it("adds the latest turn result to an idle thread tooltip", () => {
		expect(threadStatusTooltip("idle", "completed")).toBe(
			"Idle: Loaded and ready for a new turn. Last turn: Completed",
		);
		expect(threadStatusTooltip("active", "in_progress")).toBe(
			"Running: A turn is currently running",
		);
	});

	it("keeps thread runtime separate from the last turn result", () => {
		expect(threadDisplayStatus({ status: "idle", archivedAt: null })).toBe(
			"idle",
		);
		expect(
			threadDisplayStatus({
				status: "not_loaded",
				archivedAt: "2026-07-11T00:00:00.000Z",
			}),
		).toBe("archived");
	});

	it("renders a concise label and a descriptive hover title", () => {
		const markup = renderToStaticMarkup(
			createElement(StatusIndicator, { status: "interrupted" }),
		);

		expect(markup).toContain(">Interrupted</span>");
		expect(markup).toContain(
			'title="Interrupted: The turn stopped before completion"',
		);
		expect(markup).toContain("text-stale-dot");
	});
});
