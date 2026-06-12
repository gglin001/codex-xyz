import { describe, expect, it } from "vitest";
import { getTranscriptWindow } from "../src/client/transcriptWindow.js";

function items(count: number) {
  return Array.from({ length: count }, (_, index) => `item-${index + 1}`);
}

describe("transcript window", () => {
  it("keeps short transcripts intact in recent mode", () => {
    const source = items(3);
    const result = getTranscriptWindow(source, "recent", {
      recentItemCount: 2,
      windowThreshold: 4
    });

    expect(result.items).toBe(source);
    expect(result.hiddenCount).toBe(0);
    expect(result.isWindowed).toBe(false);
    expect(result.visibleCount).toBe(3);
  });

  it("keeps only the tail of long transcripts in recent mode", () => {
    const result = getTranscriptWindow(items(6), "recent", {
      recentItemCount: 3,
      windowThreshold: 4
    });

    expect(result.items).toEqual(["item-4", "item-5", "item-6"]);
    expect(result.hiddenCount).toBe(3);
    expect(result.totalCount).toBe(6);
    expect(result.visibleCount).toBe(3);
    expect(result.isWindowed).toBe(true);
  });

  it("returns the full transcript in all mode", () => {
    const source = items(6);
    const result = getTranscriptWindow(source, "all", {
      recentItemCount: 3,
      windowThreshold: 4
    });

    expect(result.items).toBe(source);
    expect(result.hiddenCount).toBe(0);
    expect(result.visibleCount).toBe(6);
    expect(result.isWindowed).toBe(false);
  });

  it("guards against invalid small window options", () => {
    const result = getTranscriptWindow(items(3), "recent", {
      recentItemCount: 0,
      windowThreshold: 0
    });

    expect(result.items).toEqual(["item-3"]);
    expect(result.hiddenCount).toBe(2);
    expect(result.visibleCount).toBe(1);
  });
});
