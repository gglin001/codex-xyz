import { describe, expect, it } from "vitest";
import { shouldPreventMobileScrollChain } from "../src/client/useMobileTouchScrollBoundary.js";

describe("mobile touch scroll boundary", () => {
	it("allows horizontal text scrolling away from a boundary", () => {
		expect(
			shouldPreventMobileScrollChain({
				dx: -24,
				dy: 8,
				horizontalScrollMetrics: {
					scrollLeft: 20,
					scrollWidth: 300,
					clientWidth: 100,
				},
				scrollMetrics: null,
			}),
		).toBe(false);
	});

	it("prevents horizontal gestures when there is no horizontal scroll target", () => {
		expect(
			shouldPreventMobileScrollChain({
				dx: 24,
				dy: 8,
				horizontalScrollMetrics: null,
				scrollMetrics: null,
			}),
		).toBe(true);
	});

	it("prevents horizontal scroll chaining at the left and right boundaries", () => {
		expect(
			shouldPreventMobileScrollChain({
				dx: 24,
				dy: 8,
				horizontalScrollMetrics: {
					scrollLeft: 0,
					scrollWidth: 300,
					clientWidth: 100,
				},
				scrollMetrics: null,
			}),
		).toBe(true);

		expect(
			shouldPreventMobileScrollChain({
				dx: -24,
				dy: 8,
				horizontalScrollMetrics: {
					scrollLeft: 200,
					scrollWidth: 300,
					clientWidth: 100,
				},
				scrollMetrics: null,
			}),
		).toBe(true);
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

	it("prevents vertical gestures when an internal host has no scroll range", () => {
		expect(
			shouldPreventMobileScrollChain({
				dx: 1,
				dy: 18,
				scrollMetrics: {
					scrollTop: 0,
					scrollHeight: 100,
					clientHeight: 100,
				},
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
