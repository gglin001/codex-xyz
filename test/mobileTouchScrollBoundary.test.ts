import { describe, expect, it } from "vitest";
import { shouldPreventMobileScrollChain } from "../src/client/useMobileTouchScrollBoundary.js";

describe("mobile touch scroll boundary", () => {
	it("allows horizontal text scrolling gestures", () => {
		expect(
			shouldPreventMobileScrollChain({
				dx: 24,
				dy: 8,
				scrollMetrics: null,
			}),
		).toBe(false);
	});

	it("prevents vertical gestures when there is no internal scroll target", () => {
		expect(
			shouldPreventMobileScrollChain({
				dx: 0,
				dy: 18,
				scrollMetrics: null,
			}),
		).toBe(true);
	});

	it("prevents vertical gestures in strict stable mode", () => {
		expect(
			shouldPreventMobileScrollChain({
				dx: 0,
				dy: -18,
				scrollMetrics: {
					scrollTop: 20,
					scrollHeight: 300,
					clientHeight: 100,
				},
				strictVertical: true,
			}),
		).toBe(true);
	});

	it("allows internal scrolling away from a boundary", () => {
		expect(
			shouldPreventMobileScrollChain({
				dx: 0,
				dy: -18,
				scrollMetrics: {
					scrollTop: 20,
					scrollHeight: 300,
					clientHeight: 100,
				},
			}),
		).toBe(false);
	});

	it("prevents scroll chaining at the top and bottom boundaries", () => {
		expect(
			shouldPreventMobileScrollChain({
				dx: 0,
				dy: 18,
				scrollMetrics: {
					scrollTop: 0,
					scrollHeight: 300,
					clientHeight: 100,
				},
			}),
		).toBe(true);

		expect(
			shouldPreventMobileScrollChain({
				dx: 0,
				dy: -18,
				scrollMetrics: {
					scrollTop: 200,
					scrollHeight: 300,
					clientHeight: 100,
				},
			}),
		).toBe(true);
	});
});
