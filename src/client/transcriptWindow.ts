export type TranscriptWindowMode = "recent" | "all";

export type TranscriptWindow<T> = {
  items: T[];
  hiddenCount: number;
  totalCount: number;
  visibleCount: number;
  isWindowed: boolean;
};

export const defaultTranscriptRecentItemCount = 200;
export const defaultTranscriptWindowThreshold = 240;

export function getTranscriptWindow<T>(
  items: T[],
  mode: TranscriptWindowMode,
  options: {
    recentItemCount?: number;
    windowThreshold?: number;
  } = {}
): TranscriptWindow<T> {
  const recentItemCount = Math.max(1, options.recentItemCount ?? defaultTranscriptRecentItemCount);
  const windowThreshold = Math.max(recentItemCount, options.windowThreshold ?? defaultTranscriptWindowThreshold);

  if (mode === "all" || items.length <= windowThreshold) {
    return {
      items,
      hiddenCount: 0,
      totalCount: items.length,
      visibleCount: items.length,
      isWindowed: false
    };
  }

  const hiddenCount = Math.max(0, items.length - recentItemCount);
  return {
    items: items.slice(hiddenCount),
    hiddenCount,
    totalCount: items.length,
    visibleCount: items.length - hiddenCount,
    isWindowed: hiddenCount > 0
  };
}
