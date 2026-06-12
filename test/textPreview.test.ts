import { describe, expect, it } from "vitest";
import { getCollapsedTextPreview } from "../src/client/textPreview.js";

describe("collapsed text preview", () => {
  it("does not collapse text within the line limit", () => {
    expect(
      getCollapsedTextPreview("one\ntwo", {
        expanded: false,
        lineCount: 2
      })
    ).toEqual({
      canCollapse: false,
      visibleText: "one\ntwo"
    });
  });

  it("returns a normalized preview when text exceeds the line limit", () => {
    expect(
      getCollapsedTextPreview("one\r\ntwo\r\nthree", {
        expanded: false,
        lineCount: 2
      })
    ).toEqual({
      canCollapse: true,
      visibleText: "one\ntwo"
    });
  });

  it("keeps the full text visible when expanded", () => {
    expect(
      getCollapsedTextPreview("one\rtwo\rthree", {
        expanded: true,
        lineCount: 2
      })
    ).toEqual({
      canCollapse: true,
      visibleText: "one\rtwo\rthree"
    });
  });

  it("treats trailing line breaks as extra lines", () => {
    expect(
      getCollapsedTextPreview("one\ntwo\n", {
        expanded: false,
        lineCount: 2
      })
    ).toEqual({
      canCollapse: true,
      visibleText: "one\ntwo"
    });
  });
});
