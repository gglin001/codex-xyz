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

function matchesThreadQuery(thread: ControlThread, query: string) {
  if (!query) {
    return true;
  }
  const fields = [
    thread.title,
    thread.preview,
    thread.cwd,
    thread.model ?? "",
    thread.status,
    thread.goalObjective ?? "",
    thread.goalStatus ?? "",
    thread.sessionId
  ];
  return fields.some((field) => field.toLowerCase().includes(query));
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

function orderThreads(threads: ControlThread[]) {
  return [...threads].sort(byUpdatedDesc);
}

export function getSessionListModel(
  threads: ControlThread[],
  tasks: Task[],
  query: string
): SessionListModel {
  const normalizedQuery = normalizeQuery(query);
  const visibleThreads = normalizedQuery
    ? threads.filter((thread) => matchesThreadQuery(thread, normalizedQuery))
    : threads;

  return {
    activeThreads: orderThreads(visibleThreads.filter((thread) => thread.status === "running")),
    attentionThreads: orderThreads(
      visibleThreads.filter((thread) => thread.status !== "running" && needsAttention(thread))
    ),
    otherThreads: orderThreads(
      visibleThreads.filter((thread) => thread.status !== "running" && !needsAttention(thread))
    ),
    queuedTaskCount: tasks.filter((task) => task.status === "queued" || task.status === "running").length,
    totalThreadCount: threads.length,
    visibleThreadCount: visibleThreads.length,
    hasQuery: normalizedQuery.length > 0
  };
}
