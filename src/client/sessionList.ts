import type { ControlThread, Task } from "../server/domain.js";

export type SessionListModel = {
  activeThreads: ControlThread[];
  attentionThreads: ControlThread[];
  otherThreads: ControlThread[];
  queuedTaskCount: number;
  totalThreadCount: number;
  visibleThreadCount: number;
  hasQuery: boolean;
};

function normalizeQuery(value: string) {
  return value.trim().toLowerCase();
}

function fieldMatchesQuery(value: string | null, query: string) {
  return Boolean(value && value.toLowerCase().includes(query));
}

function matchesThreadQuery(thread: ControlThread, query: string) {
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
    fieldMatchesQuery(thread.sessionId, query)
  );
}

function needsAttention(thread: ControlThread) {
  return (
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
  query: string
): SessionListModel {
  const normalizedQuery = normalizeQuery(query);
  const activeThreads: ControlThread[] = [];
  const attentionThreads: ControlThread[] = [];
  const otherThreads: ControlThread[] = [];
  let visibleThreadCount = 0;

  for (const thread of threads) {
    if (!matchesThreadQuery(thread, normalizedQuery)) {
      continue;
    }
    visibleThreadCount += 1;
    if (thread.status === "running") {
      activeThreads.push(thread);
    } else if (needsAttention(thread)) {
      attentionThreads.push(thread);
    } else {
      otherThreads.push(thread);
    }
  }

  return {
    activeThreads: orderThreadGroup(activeThreads),
    attentionThreads: orderThreadGroup(attentionThreads),
    otherThreads: orderThreadGroup(otherThreads),
    queuedTaskCount: countActiveTasks(tasks),
    totalThreadCount: threads.length,
    visibleThreadCount,
    hasQuery: normalizedQuery.length > 0
  };
}
