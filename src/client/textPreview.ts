export type CollapsedTextPreview = {
  canCollapse: boolean;
  visibleText: string;
};

export function getCollapsedTextPreview(
  value: string,
  options: {
    expanded: boolean;
    lineCount: number;
  }
): CollapsedTextPreview {
  const lineCount = Math.max(1, Math.floor(options.lineCount));
  const lines: string[] = [];
  let lineStart = 0;
  let index = 0;

  while (index < value.length) {
    const char = value[index];
    if (char !== "\n" && char !== "\r") {
      index += 1;
      continue;
    }

    lines.push(value.slice(lineStart, index));
    index += char === "\r" && value[index + 1] === "\n" ? 2 : 1;
    lineStart = index;

    if (lines.length >= lineCount) {
      return {
        canCollapse: true,
        visibleText: options.expanded ? value : lines.join("\n")
      };
    }
  }

  return {
    canCollapse: false,
    visibleText: value
  };
}
