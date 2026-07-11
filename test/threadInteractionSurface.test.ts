import { describe, expect, it } from "vitest";
import {
	buildUserInputAnswers,
	interactionRemainingSeconds,
} from "../src/client/components/ThreadInteractionSurface.js";
import type { UserInputInteraction } from "../src/server/domain.js";

const interaction: UserInputInteraction = {
	id: "interaction-1",
	threadId: "thread-1",
	turnId: "turn-1",
	status: "pending",
	requestedAt: "2026-07-11T00:00:00.000Z",
	resolvedAt: null,
	autoResolutionMs: 10_000,
	questions: [
		{
			id: "tools",
			header: "Tools",
			question: "Which tools?",
			isOther: true,
			isSecret: false,
			options: [{ label: "Tests", description: "Run tests" }],
		},
		{
			id: "note",
			header: "Note",
			question: "Anything else?",
			isOther: false,
			isSecret: false,
			options: null,
		},
	],
};

describe("thread interaction surface helpers", () => {
	it("combines selected options and a trimmed other answer", () => {
		expect(
			buildUserInputAnswers(
				interaction.questions,
				{ tools: ["Tests"], note: ["Ship it"] },
				{ tools: "  Typecheck  " },
			),
		).toEqual({ tools: ["Tests", "Typecheck"], note: ["Ship it"] });
	});

	it("clamps auto-resolution countdown at zero", () => {
		expect(
			interactionRemainingSeconds(
				interaction,
				Date.parse("2026-07-11T00:00:04.100Z"),
			),
		).toBe(6);
		expect(
			interactionRemainingSeconds(
				interaction,
				Date.parse("2026-07-11T00:00:11.000Z"),
			),
		).toBe(0);
	});
});
