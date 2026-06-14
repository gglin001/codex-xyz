import { History, Loader2, Moon, RefreshCw, Search, Sun, Target, Terminal } from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ControlThread, RuntimeSyncIssue } from "../../server/domain.js";
import type { SessionListModel } from "../sessionList.js";
import { formatTokens, statusLabel, statusTone } from "../uiFormat.js";
import type { ThemeMode } from "./types.js";

type SelectThreadHandler = (threadId: string) => void | Promise<void>;

export type SessionSidebarProps = {
  compactMobile?: boolean;
  busy: boolean;
  theme: ThemeMode;
  nextTheme: ThemeMode;
  terminalVisible: boolean;
  sessionQuery: string;
  sessionList: SessionListModel;
  runtimeIssuesByThreadId: ReadonlyMap<string, RuntimeSyncIssue>;
  selectedThreadId: string | null;
  loadingMoreThreads: boolean;
  onTerminalToggle: () => void;
  onThemeChange: (theme: ThemeMode) => void;
  onRefresh: () => void;
  onLoadMoreThreads: () => void;
  onSessionQueryChange: (value: string) => void;
  onSelectThread: SelectThreadHandler;
};

type SessionGroupId = "active" | "attention" | "history";

type SessionListEntry =
  | {
      kind: "heading";
      id: string;
      groupId: SessionGroupId;
      title: string;
      count: number;
    }
  | {
      kind: "empty";
      id: string;
      label: string;
    }
  | {
      kind: "thread";
      id: string;
      groupId: SessionGroupId;
      thread: ControlThread;
    }
  | {
      kind: "loadMore";
      id: string;
      loading: boolean;
    };

const compactSessionRowHeight = 64;
const goalSessionRowHeight = 88;
const mobileCompactSessionRowHeight = 58;
const mobileGoalSessionRowHeight = 82;
const sessionHeadingHeight = 30;
const sessionEmptyHeight = 50;
const sessionLoadMoreHeight = 52;
const mobileSessionHeadingHeight = 26;
const mobileSessionEmptyHeight = 42;
const mobileSessionLoadMoreHeight = 46;
const sessionOverscanRows = 5;
const loadMoreScrollThreshold = 320;

function threadHasGoal(thread: ControlThread) {
  return Boolean(thread.goalObjective && thread.goalStatus && thread.goalStatus !== "cleared");
}

function sessionEntryHeight(entry: SessionListEntry, compactMobile: boolean) {
  if (entry.kind === "thread") {
    if (compactMobile) {
      return threadHasGoal(entry.thread) ? mobileGoalSessionRowHeight : mobileCompactSessionRowHeight;
    }
    return threadHasGoal(entry.thread) ? goalSessionRowHeight : compactSessionRowHeight;
  }
  if (entry.kind === "heading") {
    return compactMobile ? mobileSessionHeadingHeight : sessionHeadingHeight;
  }
  if (entry.kind === "loadMore") {
    return compactMobile ? mobileSessionLoadMoreHeight : sessionLoadMoreHeight;
  }
  return compactMobile ? mobileSessionEmptyHeight : sessionEmptyHeight;
}

function buildSessionEntries(
  sessionList: SessionListModel,
  options: {
    compactMobile: boolean;
    loadingMoreThreads: boolean;
  }
): SessionListEntry[] {
  const entries: SessionListEntry[] = [];
  const groups: {
    id: SessionGroupId;
    title: string;
    threads: ControlThread[];
    emptyLabel: string;
    emptyQueryLabel: string;
  }[] = [
    {
      id: "active",
      title: "Active",
      threads: sessionList.activeThreads,
      emptyLabel: "No active sessions",
      emptyQueryLabel: "No matching active sessions"
    },
    {
      id: "attention",
      title: "Needs attention",
      threads: sessionList.attentionThreads,
      emptyLabel: "No attention needed",
      emptyQueryLabel: "No matching attention"
    },
    {
      id: "history",
      title: "History",
      threads: sessionList.otherThreads,
      emptyLabel: "No history",
      emptyQueryLabel: "No matching history"
    }
  ];
  const hasAnyThreads = groups.some((group) => group.threads.length > 0);
  let compactEmptyShown = false;

  for (const group of groups) {
    entries.push({
      kind: "heading",
      id: `heading:${group.id}`,
      groupId: group.id,
      title: group.title,
      count: group.threads.length
    });
    if (group.threads.length === 0) {
      if (options.compactMobile) {
        if (!hasAnyThreads && !compactEmptyShown) {
          compactEmptyShown = true;
          entries.push({
            kind: "empty",
            id: "empty:all",
            label: sessionList.hasQuery ? "No matching sessions" : "No sessions"
          });
        }
        continue;
      }
      entries.push({
        kind: "empty",
        id: `empty:${group.id}`,
        label: sessionList.hasQuery ? group.emptyQueryLabel : group.emptyLabel
      });
      continue;
    }
    for (const thread of group.threads) {
      entries.push({
        kind: "thread",
        id: `thread:${thread.id}`,
        groupId: group.id,
        thread
      });
    }
  }

  if (sessionList.hasMoreThreads) {
    entries.push({
      kind: "loadMore",
      id: "load-more",
      loading: options.loadingMoreThreads
    });
  }

  return entries;
}

function upperBound(values: number[], target: number) {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (values[middle] <= target) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return low;
}

const SessionRow = memo(function SessionRow({
  thread,
  runtimeIssue,
  selected,
  onSelectThread
}: {
  thread: ControlThread;
  runtimeIssue: RuntimeSyncIssue | null;
  selected: boolean;
  onSelectThread: SelectThreadHandler;
}) {
  const hasGoal = threadHasGoal(thread);
  const goalStatus = thread.goalStatus ? `Goal ${statusLabel(thread.goalStatus)}` : "Goal";
  const runtimeTone = runtimeIssue?.severity ?? null;
  const visibleStatus = runtimeIssue ? `runtime ${runtimeIssue.severity}` : statusLabel(thread.status);
  const visiblePreview = runtimeIssue?.message ?? (thread.preview || thread.cwd);
  const rowTitle = runtimeIssue
    ? `${thread.title}\n${runtimeIssue.message}`
    : thread.preview || thread.cwd || thread.title;

  return (
    <button
      className={`session-row ${hasGoal ? "with-goal" : "compact"} ${runtimeTone ? `runtime-${runtimeTone}` : ""} ${
        selected ? "selected" : ""
      }`}
      onClick={() => {
        void onSelectThread(thread.id);
      }}
      aria-pressed={selected}
      title={rowTitle}
    >
      <span className="session-row-main">
        <span className={`status-dot ${runtimeTone ? `runtime-${runtimeTone}` : thread.status}`} />
        <span className="session-copy">
          <strong>{thread.title}</strong>
          <small>{visiblePreview}</small>
        </span>
        <span className={`session-status ${runtimeTone ?? statusTone(thread.status)}`}>{visibleStatus}</span>
      </span>
      {hasGoal ? (
        <span className={`session-goal ${thread.goalStatus ?? ""}`} title={thread.goalObjective ?? undefined}>
          <Target size={13} />
          <span className="session-goal-copy">
            <strong>{goalStatus}</strong>
            <small>{thread.goalObjective}</small>
          </span>
          {thread.goalTokenBudget ? (
            <span className="session-goal-budget">
              {formatTokens(thread.tokensUsed)} / {formatTokens(thread.goalTokenBudget)}
            </span>
          ) : null}
        </span>
      ) : null}
    </button>
  );
});

const VirtualSessionList = memo(function VirtualSessionList({
  compactMobile,
  sessionList,
  runtimeIssuesByThreadId,
  selectedThreadId,
  loadingMoreThreads,
  onLoadMoreThreads,
  onSelectThread
}: {
  compactMobile: boolean;
  sessionList: SessionListModel;
  runtimeIssuesByThreadId: ReadonlyMap<string, RuntimeSyncIssue>;
  selectedThreadId: string | null;
  loadingMoreThreads: boolean;
  onLoadMoreThreads: () => void;
  onSelectThread: SelectThreadHandler;
}) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const entries = useMemo(
    () => buildSessionEntries(sessionList, { compactMobile, loadingMoreThreads }),
    [compactMobile, loadingMoreThreads, sessionList]
  );
  const offsets = useMemo(() => {
    const values = [0];
    for (const entry of entries) {
      values.push(values[values.length - 1] + sessionEntryHeight(entry, compactMobile));
    }
    return values;
  }, [compactMobile, entries]);
  const totalHeight = offsets[offsets.length - 1] ?? 0;
  const visibleRange = useMemo(() => {
    const first = Math.max(0, upperBound(offsets, scrollTop) - 1 - sessionOverscanRows);
    const last = Math.min(
      entries.length,
      upperBound(offsets, scrollTop + viewportHeight) + sessionOverscanRows
    );
    return {
      first,
      last: Math.max(first, last)
    };
  }, [entries.length, offsets, scrollTop, viewportHeight]);

  const maybeLoadMore = useCallback(() => {
    const element = listRef.current;
    if (!element || !sessionList.hasMoreThreads || loadingMoreThreads) {
      return;
    }
    const remaining = element.scrollHeight - element.scrollTop - element.clientHeight;
    if (remaining <= loadMoreScrollThreshold) {
      onLoadMoreThreads();
    }
  }, [loadingMoreThreads, onLoadMoreThreads, sessionList.hasMoreThreads]);

  const handleScroll = useCallback(() => {
    const element = listRef.current;
    if (!element) {
      return;
    }
    setScrollTop(element.scrollTop);
    maybeLoadMore();
  }, [maybeLoadMore]);

  useEffect(() => {
    const element = listRef.current;
    if (!element) {
      return;
    }
    const syncSize = () => {
      setViewportHeight(element.clientHeight);
      setScrollTop(element.scrollTop);
    };
    syncSize();
    const observer = new ResizeObserver(syncSize);
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    maybeLoadMore();
  }, [maybeLoadMore, totalHeight, viewportHeight]);

  return (
    <div
      ref={listRef}
      className="session-list session-list-virtual"
      aria-label="Session list"
      onScroll={handleScroll}
    >
      <div className="session-virtual-spacer" style={{ height: totalHeight }}>
        {entries.slice(visibleRange.first, visibleRange.last).map((entry, localIndex) => {
          const index = visibleRange.first + localIndex;
          const top = offsets[index] ?? 0;
          const height = sessionEntryHeight(entry, compactMobile);
          return (
            <div
              key={entry.id}
              className={`session-virtual-row ${entry.kind} ${"groupId" in entry ? entry.groupId : ""}`}
              style={{ height, transform: `translateY(${top}px)` }}
            >
              {entry.kind === "heading" ? (
                <h2 className="session-group-heading">
                  <span>{entry.title}</span>
                  <span className="session-group-count">{entry.count}</span>
                </h2>
              ) : null}
              {entry.kind === "empty" ? <div className="empty-state compact">{entry.label}</div> : null}
              {entry.kind === "thread" ? (
                <SessionRow
                  thread={entry.thread}
                  runtimeIssue={runtimeIssuesByThreadId.get(entry.thread.id) ?? null}
                  selected={entry.thread.id === selectedThreadId}
                  onSelectThread={onSelectThread}
                />
              ) : null}
              {entry.kind === "loadMore" ? (
                <button
                  type="button"
                  className="session-load-more"
                  disabled={entry.loading}
                  onClick={onLoadMoreThreads}
                >
                  {entry.loading ? "Loading more sessions..." : "Load more sessions"}
                </button>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
});

export const SessionSidebar = memo(function SessionSidebar({
  compactMobile = false,
  busy,
  theme,
  nextTheme,
  terminalVisible,
  sessionQuery,
  sessionList,
  runtimeIssuesByThreadId,
  selectedThreadId,
  loadingMoreThreads,
  onTerminalToggle,
  onThemeChange,
  onRefresh,
  onLoadMoreThreads,
  onSessionQueryChange,
  onSelectThread
}: SessionSidebarProps) {
  return (
    <section className="sessions panel">
      <div className="panel-header sessions-header">
        <div className="sessions-title">
          <strong>codex-xyz</strong>
        </div>
        <div className="panel-header-actions">
          {busy ? <Loader2 className="spin" size={18} /> : <History size={18} />}
          <button
            type="button"
            className={terminalVisible ? "active" : ""}
            title={terminalVisible ? "Hide terminal" : "Open terminal"}
            aria-label={terminalVisible ? "Hide terminal" : "Open terminal"}
            aria-pressed={terminalVisible}
            onClick={onTerminalToggle}
          >
            <Terminal size={16} />
          </button>
          <button
            type="button"
            className="theme-toggle"
            title={`Switch to ${nextTheme} mode`}
            aria-label={`Switch to ${nextTheme} mode`}
            aria-pressed={theme === "light"}
            onClick={() => onThemeChange(nextTheme)}
          >
            {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
          </button>
          <button title="Refresh" aria-label="Refresh" onClick={onRefresh} disabled={busy}>
            <RefreshCw size={16} className={busy ? "spin" : ""} />
          </button>
        </div>
      </div>

      <label className="session-search">
        <Search size={14} />
        <input
          value={sessionQuery}
          onChange={(event) => onSessionQueryChange(event.target.value)}
          placeholder="Search sessions"
          aria-label="Search sessions"
        />
      </label>

      <VirtualSessionList
        compactMobile={compactMobile}
        sessionList={sessionList}
        runtimeIssuesByThreadId={runtimeIssuesByThreadId}
        selectedThreadId={selectedThreadId}
        loadingMoreThreads={loadingMoreThreads}
        onLoadMoreThreads={onLoadMoreThreads}
        onSelectThread={onSelectThread}
      />
    </section>
  );
});
