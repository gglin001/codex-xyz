import { describe, expect, it } from "vitest";
import { readDebugLevel } from "../src/config.js";

describe("runtime environment config", () => {
	it("reads debug logging level", () => {
		expect(readDebugLevel({})).toBe(0);
		expect(readDebugLevel({ COZ_DEBUG_LEVEL: "2" })).toBe(2);
	});

	it("rejects invalid debug logging levels", () => {
		expect(() => readDebugLevel({ COZ_DEBUG_LEVEL: "4" })).toThrow(
			/integer between 0 and 3/,
		);
		expect(() => readDebugLevel({ COZ_DEBUG_LEVEL: "debug" })).toThrow(
			/integer between 0 and 3/,
		);
	});
});
