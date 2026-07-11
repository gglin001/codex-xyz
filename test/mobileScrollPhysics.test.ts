import { describe, expect, it } from "vitest";
import {
	maxScrollTop,
	resolveMobileKeyboardScrollTop,
	resolveMobileScrollMetrics,
	resolveScrollAnchorMetric,
} from "../src/client/mobileScrollPhysics.js";

describe("mobile scroll physics", () => {
	it("keeps the thumb size stable while mapping scroll progress to position", () => {
		expect(
			resolveMobileScrollMetrics({
				scrollHeight: 2000,
				clientHeight: 500,
				scrollTop: 750,
				trackHeight: 400,
			}),
		).toEqual({
			canScroll: true,
			thumbHeight: 48,
			thumbTop: 176,
			progress: 0.5,
		});
	});

	it("does not resize the thumb for very long content", () => {
		const metrics = resolveMobileScrollMetrics({
			scrollHeight: 10_000,
			clientHeight: 500,
			scrollTop: 0,
			trackHeight: 360,
		});

		expect(metrics.canScroll).toBe(true);
		expect(metrics.thumbHeight).toBe(48);
		expect(metrics.thumbTop).toBe(0);
	});

	it("reports no scroll when content or track cannot move", () => {
		expect(
			resolveMobileScrollMetrics({
				scrollHeight: 400,
				clientHeight: 500,
				scrollTop: 0,
				trackHeight: 400,
			}).canScroll,
		).toBe(false);

		expect(
			resolveMobileScrollMetrics({
				scrollHeight: 1000,
				clientHeight: 500,
				scrollTop: 0,
				trackHeight: 40,
			}).canScroll,
		).toBe(false);

		expect(
			resolveMobileScrollMetrics({
				scrollHeight: 510,
				clientHeight: 500,
				scrollTop: 0,
				trackHeight: 400,
			}).canScroll,
		).toBe(false);
	});

	it("projects prompt anchors from transcript content to the rail", () => {
		expect(
			resolveScrollAnchorMetric({
				anchorTop: 750,
				scrollHeight: 2000,
				clientHeight: 500,
				trackHeight: 400,
			}),
		).toEqual({
			top: 200,
			scrollTop: 750,
			progress: 0.5,
		});
	});

	it("keeps prompt anchor navigation inside reachable scroll bounds", () => {
		expect(
			resolveScrollAnchorMetric({
				anchorTop: 1900,
				scrollHeight: 2000,
				clientHeight: 500,
				trackHeight: 400,
			}),
		).toEqual({
			top: 376,
			scrollTop: 1500,
			progress: 1,
		});
	});

	it("scales keyboard arrow movement with the viewport height", () => {
		expect(
			resolveMobileKeyboardScrollTop({
				key: "ArrowDown",
				scrollHeight: 2000,
				clientHeight: 500,
				scrollTop: 100,
			}),
		).toBe(170);

		expect(
			resolveMobileKeyboardScrollTop({
				key: "ArrowDown",
				scrollHeight: 4000,
				clientHeight: 1200,
				scrollTop: 100,
			}),
		).toBe(212);
	});

	it("keeps keyboard scrolling inside the physical bounds", () => {
		expect(
			resolveMobileKeyboardScrollTop({
				key: "ArrowUp",
				scrollHeight: 2000,
				clientHeight: 500,
				scrollTop: 10,
			}),
		).toBe(0);

		expect(
			resolveMobileKeyboardScrollTop({
				key: "End",
				scrollHeight: 2000,
				clientHeight: 500,
				scrollTop: 10,
			}),
		).toBe(1500);

		expect(maxScrollTop(2000, 500)).toBe(1500);
		expect(maxScrollTop(500, 2000)).toBe(0);
	});
});
