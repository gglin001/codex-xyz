import type { ControlThread } from "../server/domain.js";

export type SessionProjectGroup = {
  id: string;
  name: string;
  path: string;
  threads: ControlThread[];
  threadCount: number;
  runningCount: number;
  attentionCount: number;
  goalCount: number;
  updatedAt: string;
};

export type SessionListModel = {
  threads: ControlThread[];
  projectGroups: SessionProjectGroup[];
  loadedThreadCount: number;
  totalThreadCount: number;
  visibleThreadCount: number;
  visibleProjectCount: number;
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

function byUpdatedDesc(a: ControlThread, b: ControlThread) {
  return b.updatedAt.localeCompare(a.updatedAt);
}

function orderThreads(threads: ControlThread[]) {
  return threads.sort(byUpdatedDesc);
}

function basenameFromPath(value: string) {
  const trimmed = value.trim().replace(/[\\/]+$/, "");
  if (!trimmed) {
    return "Unknown workdir";
  }
  return trimmed.split(/[\\/]/).filter(Boolean).pop() ?? trimmed;
}

function threadNeedsAttention(thread: ControlThread) {
  return thread.status === "failed" || thread.status === "interrupted" || thread.status === "stale";
}

function threadHasGoal(thread: ControlThread) {
  return Boolean(thread.goalObjective && thread.goalStatus && thread.goalStatus !== "cleared");
}

function buildProjectGroups(threads: ControlThread[]) {
  const groups = new Map<string, SessionProjectGroup>();

  for (const thread of threads) {
    const path = thread.cwd.trim() || "Unknown workdir";
    const id = path;
    let group = groups.get(id);

    if (!group) {
      group = {
        id,
        name: basenameFromPath(path),
        path,
        threads: [],
        threadCount: 0,
        runningCount: 0,
        attentionCount: 0,
        goalCount: 0,
        updatedAt: thread.updatedAt
      };
      groups.set(id, group);
    }

    group.threads.push(thread);
    group.threadCount += 1;
    group.runningCount += thread.status === "running" ? 1 : 0;
    group.attentionCount += threadNeedsAttention(thread) ? 1 : 0;
    group.goalCount += threadHasGoal(thread) ? 1 : 0;
    if (thread.updatedAt.localeCompare(group.updatedAt) > 0) {
      group.updatedAt = thread.updatedAt;
    }
  }

  return Array.from(groups.values());
}

export function getSessionListModel(
  threads: ControlThread[],
  query: string,
  options: {
    totalThreadCount?: number;
    hasMoreThreads?: boolean;
  } = {}
): SessionListModel {
  const normalizedQuery = normalizeQuery(query);
  const visibleThreads: ControlThread[] = [];
  let visibleThreadCount = 0;

  for (const thread of threads) {
    if (!matchesThreadQuery(thread, normalizedQuery)) {
      continue;
    }
    visibleThreadCount += 1;
    visibleThreads.push(thread);
  }
  const orderedThreads = orderThreads(visibleThreads);
  const projectGroups = buildProjectGroups(orderedThreads);

  return {
    threads: orderedThreads,
    projectGroups,
    loadedThreadCount: threads.length,
    totalThreadCount: options.totalThreadCount ?? threads.length,
    visibleThreadCount,
    visibleProjectCount: projectGroups.length,
    hasMoreThreads: options.hasMoreThreads ?? false,
    hasQuery: normalizedQuery.length > 0
  };
}
