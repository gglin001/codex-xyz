import { describe, expect, it } from "vitest";
import { getFirstLineTextPreview } from "../src/client/textPreview.js";

describe("text preview", () => {
	it("returns the normalized first line for collapsed row summaries", () => {
		expect(getFirstLineTextPreview("  first   line  \nsecond line")).toBe(
			"first line",
		);
	});

	it("truncates long collapsed row summaries with an ellipsis", () => {
		expect(getFirstLineTextPreview("abcdefghij", 7)).toBe("abcd...");
	});
});
