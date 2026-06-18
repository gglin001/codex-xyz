import {
  Activity,
  Check,
  Folder,
  History,
  ListChecks,
  Loader2,
  MessageSquarePlus,
  Moon,
  RefreshCw,
  Search,
  Settings,
  Target,
  Terminal,
  WrapText
} from "lucide-react";
import type { FocusEvent, KeyboardEvent } from "react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ControlThread, Project, RuntimeSyncIssue } from "../../server/domain.js";
import type { SessionListModel } from "../sessionList.js";
import { formatDateTime, formatTokens, statusLabel, statusTone } from "../uiFormat.js";
import type { ThemeMode } from "./types.js";

type SelectThreadHandler = (threadId: string) => void | Promise<void>;

export type SessionSidebarProps = {
  density?: SessionListDensity;
  busy: boolean;
  theme: ThemeMode;
  nextTheme: ThemeMode;
  detailWordWrap: boolean;
  terminalVisible: boolean;
  projects: Project[];
  selectedProjectId: string | null;
  sessionQuery: string;
  sessionList: SessionListModel;
  runtimeIssuesByThreadId: ReadonlyMap<string, RuntimeSyncIssue>;
  selectedThreadId: string | null;
  loadingMoreThreads: boolean;
  onNewSession: () => void;
  onTerminalToggle: () => void;
  onThemeChange: (theme: ThemeMode) => void;
  onDetailWordWrapChange: (enabled: boolean) => void;
  onRefresh: () => void;
  onLoadMoreThreads: () => void;
  onSessionQueryChange: (value: string) => void;
  onSelectThread: SelectThreadHandler;
};

export type SessionListDensity = "regular" | "compact";

type SessionListEntry =
  | {
      kind: "empty";
      id: string;
      label: string;
    }
  | {
      kind: "thread";
      id: string;
      thread: ControlThread;
    }
  | {
      kind: "loadMore";
      id: string;
      loading: boolean;
    };

const sessionEntryHeights: Record<
  SessionListDensity,
  {
    compactRow: number;
    goalRow: number;
    empty: number;
    loadMore: number;
  }
> = {
  regular: {
    compactRow: 64,
    goalRow: 88,
    empty: 50,
    loadMore: 52
  },
  compact: {
    compactRow: 58,
    goalRow: 82,
    empty: 42,
    loadMore: 46
  }
};
const sessionOverscanRows = 5;
const loadMoreScrollThreshold = 320;

function threadHasGoal(thread: ControlThread) {
  return Boolean(thread.goalObjective && thread.goalStatus && thread.goalStatus !== "cleared");
}

function sessionEntryHeight(entry: SessionListEntry, density: SessionListDensity) {
  const heights = sessionEntryHeights[density];
  if (entry.kind === "thread") {
    return threadHasGoal(entry.thread) ? heights.goalRow : heights.compactRow;
  }
  if (entry.kind === "loadMore") {
    return heights.loadMore;
  }
  return heights.empty;
}

function buildSessionEntries(
  sessionList: SessionListModel,
  options: {
    loadingMoreThreads: boolean;
  }
): SessionListEntry[] {
  const entries: SessionListEntry[] = [];

  if (sessionList.threads.length === 0) {
    entries.push({
      kind: "empty",
      id: "empty:all",
      label: sessionList.hasQuery ? "No matching sessions" : "No sessions"
    });
    if (sessionList.hasMoreThreads) {
      entries.push({
        kind: "loadMore",
        id: "load-more",
        loading: options.loadingMoreThreads
      });
    }
    return entries;
  }

  for (const thread of sessionList.threads) {
    entries.push({
      kind: "thread",
      id: `thread:${thread.id}`,
      thread
    });
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
  const visibleUpdatedAt = formatDateTime(thread.updatedAt);
  const rowTitle = runtimeIssue
    ? `${thread.title}\n${runtimeIssue.message}\nUpdated ${visibleUpdatedAt}`
    : `${thread.preview || thread.cwd || thread.title}\nUpdated ${visibleUpdatedAt}`;

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
          <span className="session-title-line">
            <strong>{thread.title}</strong>
            <time className="session-updated" dateTime={thread.updatedAt} title={`Updated ${visibleUpdatedAt}`}>
              {visibleUpdatedAt}
            </time>
          </span>
          <span className="session-meta-line">
            <small>{visiblePreview}</small>
            <span className={`session-status ${runtimeTone ?? statusTone(thread.status)}`}>{visibleStatus}</span>
          </span>
        </span>
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
  density,
  sessionList,
  runtimeIssuesByThreadId,
  selectedThreadId,
  loadingMoreThreads,
  onLoadMoreThreads,
  onSelectThread
}: {
  density: SessionListDensity;
  sessionList: SessionListModel;
  runtimeIssuesByThreadId: ReadonlyMap<string, RuntimeSyncIssue>;
  selectedThreadId: string | null;
  loadingMoreThreads: boolean;
  onLoadMoreThreads: () => void;
  onSelectThread: SelectThreadHandler;
}) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const scrollFrameRef = useRef<number | null>(null);
  const pendingScrollTopRef = useRef(0);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const entries = useMemo(
    () => buildSessionEntries(sessionList, { loadingMoreThreads }),
    [loadingMoreThreads, sessionList]
  );
  const offsets = useMemo(() => {
    const values = [0];
    for (const entry of entries) {
      values.push(values[values.length - 1] + sessionEntryHeight(entry, density));
    }
    return values;
  }, [density, entries]);
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

  const flushScrollState = useCallback(() => {
    scrollFrameRef.current = null;
    setScrollTop(pendingScrollTopRef.current);
    maybeLoadMore();
  }, [maybeLoadMore]);

  const handleScroll = useCallback(() => {
    const element = listRef.current;
    if (!element) {
      return;
    }
    pendingScrollTopRef.current = element.scrollTop;
    if (scrollFrameRef.current !== null) {
      return;
    }
    scrollFrameRef.current = window.requestAnimationFrame(flushScrollState);
  }, [flushScrollState]);

  useEffect(() => {
    const element = listRef.current;
    if (!element) {
      return;
    }
    const syncSize = () => {
      pendingScrollTopRef.current = element.scrollTop;
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

  useEffect(() => {
    return () => {
      if (scrollFrameRef.current !== null) {
        window.cancelAnimationFrame(scrollFrameRef.current);
      }
    };
  }, []);

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
          const height = sessionEntryHeight(entry, density);
          return (
            <div
              key={entry.id}
              className={`session-virtual-row ${entry.kind}`}
              style={{ height, transform: `translateY(${top}px)` }}
            >
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

function SidebarSettingsMenu({
  theme,
  nextTheme,
  detailWordWrap,
  onThemeChange,
  onDetailWordWrapChange
}: {
  theme: ThemeMode;
  nextTheme: ThemeMode;
  detailWordWrap: boolean;
  onThemeChange: (theme: ThemeMode) => void;
  onDetailWordWrapChange: (enabled: boolean) => void;
}) {
  const [open, setOpen] = useState(false);

  function handleBlur(event: FocusEvent<HTMLDivElement>) {
    const nextTarget = event.relatedTarget;
    if (!(nextTarget instanceof Node) || !event.currentTarget.contains(nextTarget)) {
      setOpen(false);
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
    }
  }

  return (
    <div className={`sidebar-settings-menu ${open ? "open" : ""}`} onBlur={handleBlur} onKeyDown={handleKeyDown}>
      <button
        type="button"
        className="sidebar-settings-trigger"
        title="Settings"
        aria-label="Settings"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <Settings size={16} />
      </button>
      {open ? (
        <div className="sidebar-settings-popover" role="menu" aria-label="Settings">
          <button
            type="button"
            className={`sidebar-settings-item ${theme === "dark" ? "active" : ""}`}
            role="menuitemcheckbox"
            aria-checked={theme === "dark"}
            onClick={() => onThemeChange(nextTheme)}
          >
            <Moon size={15} />
            <span>Dark mode</span>
            <span className="sidebar-settings-check" aria-hidden="true">
              {theme === "dark" ? <Check size={15} /> : null}
            </span>
          </button>
          <button
            type="button"
            className={`sidebar-settings-item ${detailWordWrap ? "active" : ""}`}
            role="menuitemcheckbox"
            aria-checked={detailWordWrap}
            onClick={() => onDetailWordWrapChange(!detailWordWrap)}
          >
            <WrapText size={15} />
            <span>Word wrap</span>
            <span className="sidebar-settings-check" aria-hidden="true">
              {detailWordWrap ? <Check size={15} /> : null}
            </span>
          </button>
        </div>
      ) : null}
    </div>
  );
}

function projectNameFromPath(path: string) {
  const normalized = path.replace(/\/+$/, "");
  return normalized.split("/").filter(Boolean).pop() || path || "Project";
}

export const SessionSidebar = memo(function SessionSidebar({
  density = "regular",
  busy,
  theme,
  nextTheme,
  detailWordWrap,
  terminalVisible,
  projects,
  selectedProjectId,
  sessionQuery,
  sessionList,
  runtimeIssuesByThreadId,
  selectedThreadId,
  loadingMoreThreads,
  onNewSession,
  onTerminalToggle,
  onThemeChange,
  onDetailWordWrapChange,
  onRefresh,
  onLoadMoreThreads,
  onSessionQueryChange,
  onSelectThread
}: SessionSidebarProps) {
  const selectedThread = sessionList.threads.find((thread) => thread.id === selectedThreadId) ?? null;
  const selectedProject = projects.find((project) => project.id === selectedProjectId) ?? null;
  const leadingProjects = projects.slice(0, 5);
  const visibleProjects =
    projects.length > 0
      ? selectedProject && !leadingProjects.some((project) => project.id === selectedProject.id)
        ? [...projects.slice(0, 4), selectedProject]
        : leadingProjects
      : null;
  const runningThreadCount = sessionList.threads.filter((thread) => thread.status === "running").length;
  const runtimeIssueCount = runtimeIssuesByThreadId.size;
  const activeProjectName =
    selectedProject?.name ??
    (selectedThread ? projectNameFromPath(selectedThread.cwd) : "Codex");

  return (
    <section className="sessions panel" aria-label="Workspace navigation">
      <div className="workspace-window-bar" aria-label="Workspace controls">
        <div className="workspace-brand">
          <strong>codex-xyz</strong>
          <span>
            {sessionList.loadedThreadCount}
            {sessionList.totalThreadCount > sessionList.loadedThreadCount ? ` / ${sessionList.totalThreadCount}` : ""} sessions
          </span>
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
          <button title="Refresh" aria-label="Refresh" onClick={onRefresh} disabled={busy}>
            <RefreshCw size={16} className={busy ? "spin" : ""} />
          </button>
        </div>
      </div>

      <nav className="workspace-nav" aria-label="Primary">
        <button type="button" className="workspace-nav-item" onClick={onNewSession}>
          <MessageSquarePlus size={19} />
          <span>New session</span>
        </button>
        <label className="workspace-nav-item workspace-search">
          <Search size={19} />
          <input
            value={sessionQuery}
            onChange={(event) => onSessionQueryChange(event.target.value)}
            placeholder="Search sessions"
            aria-label="Search sessions"
          />
        </label>
      </nav>

      <div className="workspace-section workspace-runtime">
        <div className="workspace-section-heading">
          <h2>Runtime</h2>
        </div>
        <div className="workspace-metrics" aria-label="Runtime summary">
          <div className="workspace-metric">
            <Activity size={16} />
            <span>Running</span>
            <strong>{runningThreadCount}</strong>
          </div>
          <div className="workspace-metric">
            <ListChecks size={16} />
            <span>Queue</span>
            <strong>{sessionList.queuedTaskCount}</strong>
          </div>
          <div className={`workspace-metric ${runtimeIssueCount > 0 ? "attention" : ""}`}>
            <Target size={16} />
            <span>Issues</span>
            <strong>{runtimeIssueCount}</strong>
          </div>
        </div>
      </div>

      <div className="workspace-section workspace-projects">
        <h2>Projects</h2>
        <div className="workspace-project-list">
          {visibleProjects ? (
            visibleProjects.map((project) => (
              <div
                key={project.id}
                className={`workspace-project ${project.id === selectedProjectId ? "active" : ""}`}
                title={project.path}
              >
                <span className="workspace-project-label">
                  <Folder size={18} />
                  <span>{project.name || projectNameFromPath(project.path)}</span>
                </span>
              </div>
            ))
          ) : (
            <div className="workspace-project active">
              <span className="workspace-project-label">
                <Folder size={18} />
                <span>{activeProjectName}</span>
              </span>
            </div>
          )}
        </div>
      </div>

      <div className="workspace-section workspace-chats">
        <div className="workspace-section-heading">
          <h2>Sessions</h2>
          <span>{sessionList.visibleThreadCount}</span>
        </div>
      </div>

      <VirtualSessionList
        density={density}
        sessionList={sessionList}
        runtimeIssuesByThreadId={runtimeIssuesByThreadId}
        selectedThreadId={selectedThreadId}
        loadingMoreThreads={loadingMoreThreads}
        onLoadMoreThreads={onLoadMoreThreads}
        onSelectThread={onSelectThread}
      />

      <div className="workspace-settings-row">
        <SidebarSettingsMenu
          theme={theme}
          nextTheme={nextTheme}
          detailWordWrap={detailWordWrap}
          onThemeChange={onThemeChange}
          onDetailWordWrapChange={onDetailWordWrapChange}
        />
        <span>Settings</span>
      </div>
    </section>
  );
});
