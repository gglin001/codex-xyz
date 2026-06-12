import { describe, expect, it } from "vitest";
import { choosePreferredThreadId } from "../src/client/threadSelection.js";

const threads = [{ id: "thread-a" }, { id: "thread-b" }];

describe("thread selection", () => {
  it("prefers an explicit requested thread when it exists", () => {
    expect(
      choosePreferredThreadId(threads, {
        currentThreadId: "thread-a",
        requestedThreadId: "thread-b",
        preferRequestedThread: true
      })
    ).toBe("thread-b");
  });

  it("keeps the current selection for non-explicit refreshes", () => {
    expect(
      choosePreferredThreadId(threads, {
        currentThreadId: "thread-b",
        requestedThreadId: "thread-a",
        preferRequestedThread: false
      })
    ).toBe("thread-b");
  });

  it("falls back to the requested thread when the current selection is gone", () => {
    expect(
      choosePreferredThreadId(threads, {
        currentThreadId: "missing",
        requestedThreadId: "thread-a",
        preferRequestedThread: false
      })
    ).toBe("thread-a");
  });

  it("falls back to the first thread or null", () => {
    expect(
      choosePreferredThreadId(threads, {
        currentThreadId: "missing",
        requestedThreadId: "also-missing",
        preferRequestedThread: true
      })
    ).toBe("thread-a");
    expect(
      choosePreferredThreadId([], {
        currentThreadId: "missing",
        requestedThreadId: "also-missing",
        preferRequestedThread: true
      })
    ).toBeNull();
  });
});
