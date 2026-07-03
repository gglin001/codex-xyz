import { describe, expect, it } from "vitest";
import {
	formatDate,
	formatDateTime,
	formatFullDateTime,
	formatTime,
} from "../src/client/uiFormat.js";

const shortMonthNames = [
	"Jan",
	"Feb",
	"Mar",
	"Apr",
	"May",
	"Jun",
	"Jul",
	"Aug",
	"Sep",
	"Oct",
	"Nov",
	"Dec",
] as const;

function localFullDateTime(value: string) {
	const date = new Date(value);
	const month = shortMonthNames[date.getMonth()];
	const day = date.getDate();
	const year = date.getFullYear();
	const hour = String(date.getHours()).padStart(2, "0");
	const minute = String(date.getMinutes()).padStart(2, "0");
	return `${month} ${day}, ${year} ${hour}:${minute}`;
}

describe("UI formatting", () => {
	it("formats UTC times with a 24-hour clock by default", () => {
		const timestamp = "2026-06-13T00:03:00.000Z";

		expect(formatTime(timestamp)).toMatch(/00.*03/);
		expect(formatDateTime(timestamp)).toMatch(/00.*03/);
		expect(formatTime(timestamp)).not.toMatch(/\b(?:AM|PM)\b/i);
		expect(formatDateTime(timestamp)).not.toMatch(/\b(?:AM|PM)\b/i);
		expect(formatFullDateTime(timestamp)).toBe("Jun 13, 2026 00:03");
		expect(formatDate(timestamp)).toBe("Jun 13, 2026");
	});

	it("can format explicit local times after hydration", () => {
		const timestamp = "2026-07-03T01:50:00.000Z";

		expect(formatFullDateTime(timestamp, "local")).toBe(
			localFullDateTime(timestamp),
		);
	});
});
