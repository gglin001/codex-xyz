import type { ControlThread, RuntimeSyncIssue, Task } from "../server/domain.js";

export type SessionListModel = {
  activeThreads: ControlThread[];
  attentionThreads: ControlThread[];
  otherThreads: ControlThread[];
  queuedTaskCount: number;
  loadedThreadCount: number;
  totalThreadCount: number;
  visibleThreadCount: number;
  hasMoreThreads: boolean;
  hasQuery: boolean;
};

export function selectionTouchesThreadGroup(
  threads: ControlThread[],
  previousThreadId: string | null,
  nextThreadId: string | null
) {
  if (previousThreadId === nextThreadId) {
    return false;
  }
  for (const thread of threads) {
    if (thread.id === previousThreadId || thread.id === nextThreadId) {
      return true;
    }
  }
  return false;
}

function normalizeQuery(value: string) {
  return value.trim().toLowerCase();
}

function fieldMatchesQuery(value: string | null, query: string) {
  return Boolean(value && value.toLowerCase().includes(query));
}

function matchesThreadQuery(thread: ControlThread, query: string, runtimeIssue: RuntimeSyncIssue | null) {
  if (!query) {
    return true;
  }
  return (
    fieldMatchesQuery(thread.title, query) ||
    fieldMatchesQuery(thread.preview, query) ||
    fieldMatchesQuery(thread.cwd, query) ||
    fieldMatchesQuery(thread.model, query) ||
    fieldMatchesQuery(thread.status, query) ||
    fieldMatchesQuery(thread.goalObjective, query) ||
    fieldMatchesQuery(thread.goalStatus, query) ||
    fieldMatchesQuery(thread.sessionId, query) ||
    fieldMatchesQuery(runtimeIssue?.severity ?? null, query) ||
    fieldMatchesQuery(runtimeIssue?.runtimeStatus ?? null, query) ||
    fieldMatchesQuery(runtimeIssue?.message ?? null, query)
  );
}

function needsAttention(thread: ControlThread, runtimeIssue: RuntimeSyncIssue | null) {
  return (
    Boolean(runtimeIssue) ||
    thread.status === "failed" ||
    thread.status === "interrupted" ||
    thread.status === "stale" ||
    thread.goalStatus === "blocked"
  );
}

function byUpdatedDesc(a: ControlThread, b: ControlThread) {
  return b.updatedAt.localeCompare(a.updatedAt);
}

function orderThreadGroup(threads: ControlThread[]) {
  return threads.sort(byUpdatedDesc);
}

function countActiveTasks(tasks: Task[]) {
  let count = 0;
  for (const task of tasks) {
    if (task.status === "queued" || task.status === "running") {
      count += 1;
    }
  }
  return count;
}

export function getSessionListModel(
  threads: ControlThread[],
  tasks: Task[],
  query: string,
  options: {
    totalThreadCount?: number;
    hasMoreThreads?: boolean;
    runtimeIssuesByThreadId?: ReadonlyMap<string, RuntimeSyncIssue>;
  } = {}
): SessionListModel {
  const normalizedQuery = normalizeQuery(query);
  const activeThreads: ControlThread[] = [];
  const attentionThreads: ControlThread[] = [];
  const otherThreads: ControlThread[] = [];
  let visibleThreadCount = 0;

  for (const thread of threads) {
    const runtimeIssue = options.runtimeIssuesByThreadId?.get(thread.id) ?? null;
    if (!matchesThreadQuery(thread, normalizedQuery, runtimeIssue)) {
      continue;
    }
    visibleThreadCount += 1;
    if (needsAttention(thread, runtimeIssue)) {
      attentionThreads.push(thread);
    } else if (thread.status === "running") {
      activeThreads.push(thread);
    } else {
      otherThreads.push(thread);
    }
  }

  return {
    activeThreads: orderThreadGroup(activeThreads),
    attentionThreads: orderThreadGroup(attentionThreads),
    otherThreads: orderThreadGroup(otherThreads),
    queuedTaskCount: countActiveTasks(tasks),
    loadedThreadCount: threads.length,
    totalThreadCount: options.totalThreadCount ?? threads.length,
    visibleThreadCount,
    hasMoreThreads: options.hasMoreThreads ?? false,
    hasQuery: normalizedQuery.length > 0
  };
}
