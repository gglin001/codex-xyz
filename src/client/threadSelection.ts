import type { ControlThread } from "../server/domain.js";

export function choosePreferredThreadId(
  threads: Pick<ControlThread, "id">[],
  options: {
    currentThreadId: string | null;
    requestedThreadId: string | null;
    preferRequestedThread: boolean;
  }
) {
  const hasThread = (threadId: string | null) =>
    Boolean(threadId && threads.some((thread) => thread.id === threadId));

  if (options.preferRequestedThread && hasThread(options.requestedThreadId)) {
    return options.requestedThreadId;
  }
  if (hasThread(options.currentThreadId)) {
    return options.currentThreadId;
  }
  if (hasThread(options.requestedThreadId)) {
    return options.requestedThreadId;
  }
  return threads[0]?.id ?? null;
}
