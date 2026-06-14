import { describe, expect, it } from "vitest";
import { formatDateTime, formatTime } from "../src/client/uiFormat.js";

describe("UI formatting", () => {
  it("formats times with a 24-hour clock", () => {
    const localMidnight = "2026-06-13T00:03:00.000";

    expect(formatTime(localMidnight)).toMatch(/00.*03/);
    expect(formatDateTime(localMidnight)).toMatch(/00.*03/);
    expect(formatTime(localMidnight)).not.toMatch(/\b(?:AM|PM)\b/i);
    expect(formatDateTime(localMidnight)).not.toMatch(/\b(?:AM|PM)\b/i);
  });
});
