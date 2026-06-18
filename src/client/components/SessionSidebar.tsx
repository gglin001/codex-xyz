import {
  Check,
  ChevronDown,
  ChevronRight,
  FolderOpen,
  History,
  Loader2,
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
import type { ControlThread, RuntimeSyncIssue } from "../../server/domain.js";
import type { SessionListModel, SessionProjectGroup } from "../sessionList.js";
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
  sessionQuery: string;
  sessionList: SessionListModel;
  runtimeIssuesByThreadId: ReadonlyMap<string, RuntimeSyncIssue>;
  selectedThreadId: string | null;
  loadingMoreThreads: boolean;
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
      kind: "project";
      id: string;
      group: SessionProjectGroup;
      collapsed: boolean;
      containsSelected: boolean;
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
    projectHeading: number;
    empty: number;
    loadMore: number;
  }
> = {
  regular: {
    compactRow: 64,
    goalRow: 88,
    projectHeading: 54,
    empty: 50,
    loadMore: 52
  },
  compact: {
    compactRow: 58,
    goalRow: 82,
    projectHeading: 48,
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
  if (entry.kind === "project") {
    return heights.projectHeading;
  }
  if (entry.kind === "loadMore") {
    return heights.loadMore;
  }
  return heights.empty;
}

function buildSessionEntries(
  sessionList: SessionListModel,
  options: {
    collapsedProjectIds: ReadonlySet<string>;
    selectedThreadId: string | null;
    loadingMoreThreads: boolean;
  }
): SessionListEntry[] {
  const entries: SessionListEntry[] = [];

  if (sessionList.projectGroups.length === 0) {
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

  for (const group of sessionList.projectGroups) {
    const collapsed = !sessionList.hasQuery && options.collapsedProjectIds.has(group.id);
    const containsSelected = Boolean(
      options.selectedThreadId && group.threads.some((thread) => thread.id === options.selectedThreadId)
    );
    entries.push({
      kind: "project",
      id: `project:${group.id}`,
      group,
      collapsed,
      containsSelected
    });

    if (collapsed) {
      continue;
    }

    for (const thread of group.threads) {
      entries.push({
        kind: "thread",
        id: `thread:${thread.id}`,
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

function projectHeadingTitle(group: SessionProjectGroup) {
  const parts = [
    group.path,
    `${group.threadCount} ${group.threadCount === 1 ? "session" : "sessions"}`
  ];
  if (group.runningCount > 0) {
    parts.push(`${group.runningCount} running`);
  }
  if (group.attentionCount > 0) {
    parts.push(`${group.attentionCount} attention`);
  }
  if (group.goalCount > 0) {
    parts.push(`${group.goalCount} goals`);
  }
  return parts.join("\n");
}

const ProjectGroupHeading = memo(function ProjectGroupHeading({
  group,
  collapsed,
  containsSelected,
  onToggleProject
}: {
  group: SessionProjectGroup;
  collapsed: boolean;
  containsSelected: boolean;
  onToggleProject: (projectId: string) => void;
}) {
  const updatedAt = formatDateTime(group.updatedAt);

  return (
    <button
      type="button"
      className={`session-project-heading ${collapsed ? "collapsed" : "expanded"} ${
        containsSelected ? "contains-selected" : ""
      }`}
      aria-expanded={!collapsed}
      title={projectHeadingTitle(group)}
      onClick={() => onToggleProject(group.id)}
    >
      <span className="session-project-chevron" aria-hidden="true">
        {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
      </span>
      <span className="session-project-icon" aria-hidden="true">
        <FolderOpen size={15} />
      </span>
      <span className="session-project-copy">
        <strong>{group.name}</strong>
        <small>{group.path}</small>
      </span>
      <span className="session-project-meta">
        {group.runningCount > 0 ? <span className="session-project-chip running">{group.runningCount}</span> : null}
        {group.attentionCount > 0 ? <span className="session-project-chip attention">{group.attentionCount}</span> : null}
        {group.issueCount > 0 ? <span className="session-project-chip issue">{group.issueCount}</span> : null}
        <span className="session-project-chip count">{group.threadCount}</span>
        <time dateTime={group.updatedAt} title={`Updated ${updatedAt}`}>
          {updatedAt}
        </time>
      </span>
    </button>
  );
});

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
  const visiblePreview = runtimeIssue?.message ?? (thread.preview || thread.model || thread.cwd);
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
  collapsedProjectIds,
  runtimeIssuesByThreadId,
  selectedThreadId,
  loadingMoreThreads,
  onToggleProject,
  onLoadMoreThreads,
  onSelectThread
}: {
  density: SessionListDensity;
  sessionList: SessionListModel;
  collapsedProjectIds: ReadonlySet<string>;
  runtimeIssuesByThreadId: ReadonlyMap<string, RuntimeSyncIssue>;
  selectedThreadId: string | null;
  loadingMoreThreads: boolean;
  onToggleProject: (projectId: string) => void;
  onLoadMoreThreads: () => void;
  onSelectThread: SelectThreadHandler;
}) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const scrollFrameRef = useRef<number | null>(null);
  const pendingScrollTopRef = useRef(0);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const entries = useMemo(
    () => buildSessionEntries(sessionList, { collapsedProjectIds, loadingMoreThreads, selectedThreadId }),
    [collapsedProjectIds, loadingMoreThreads, selectedThreadId, sessionList]
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
              {entry.kind === "project" ? (
                <ProjectGroupHeading
                  group={entry.group}
                  collapsed={entry.collapsed}
                  containsSelected={entry.containsSelected}
                  onToggleProject={onToggleProject}
                />
              ) : null}
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

export const SessionSidebar = memo(function SessionSidebar({
  density = "regular",
  busy,
  theme,
  nextTheme,
  detailWordWrap,
  terminalVisible,
  sessionQuery,
  sessionList,
  runtimeIssuesByThreadId,
  selectedThreadId,
  loadingMoreThreads,
  onTerminalToggle,
  onThemeChange,
  onDetailWordWrapChange,
  onRefresh,
  onLoadMoreThreads,
  onSessionQueryChange,
  onSelectThread
}: SessionSidebarProps) {
  const [collapsedProjectIds, setCollapsedProjectIds] = useState<Set<string>>(() => new Set());
  const visibleProjectIdKey = useMemo(
    () => sessionList.projectGroups.map((group) => group.id).join("\u0000"),
    [sessionList.projectGroups]
  );
  const visibleProjectIds = useMemo(() => new Set(visibleProjectIdKey.split("\u0000").filter(Boolean)), [visibleProjectIdKey]);
  const selectedProjectId = useMemo(() => {
    if (!selectedThreadId) {
      return null;
    }
    return sessionList.projectGroups.find((group) => group.threads.some((thread) => thread.id === selectedThreadId))?.id ?? null;
  }, [selectedThreadId, sessionList.projectGroups]);
  const collapsibleProjectCount = sessionList.projectGroups.length;
  const collapsedVisibleProjectCount = sessionList.hasQuery
    ? 0
    : sessionList.projectGroups.filter((group) => collapsedProjectIds.has(group.id)).length;
  const allVisibleProjectsCollapsed = collapsibleProjectCount > 0 && collapsedVisibleProjectCount === collapsibleProjectCount;

  useEffect(() => {
    setCollapsedProjectIds((current) => {
      let changed = false;
      const next = new Set<string>();
      for (const id of current) {
        if (visibleProjectIds.has(id)) {
          next.add(id);
        } else {
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [visibleProjectIds]);

  useEffect(() => {
    if (!selectedProjectId) {
      return;
    }
    setCollapsedProjectIds((current) => {
      if (!current.has(selectedProjectId)) {
        return current;
      }
      const next = new Set(current);
      next.delete(selectedProjectId);
      return next;
    });
  }, [selectedProjectId]);

  const toggleProject = useCallback((projectId: string) => {
    setCollapsedProjectIds((current) => {
      const next = new Set(current);
      if (next.has(projectId)) {
        next.delete(projectId);
      } else {
        next.add(projectId);
      }
      return next;
    });
  }, []);

  const toggleAllProjects = useCallback(() => {
    setCollapsedProjectIds((current) => {
      if (allVisibleProjectsCollapsed) {
        return new Set();
      }
      const next = new Set(current);
      for (const group of sessionList.projectGroups) {
        next.add(group.id);
      }
      return next;
    });
  }, [allVisibleProjectsCollapsed, sessionList.projectGroups]);
  const totalSessionLabel =
    sessionList.totalThreadCount === sessionList.loadedThreadCount
      ? `${sessionList.visibleThreadCount} sessions`
      : `${sessionList.visibleThreadCount} / ${sessionList.totalThreadCount} sessions`;
  const collapseAllTitle = allVisibleProjectsCollapsed ? "Expand workdirs" : "Collapse workdirs";

  return (
    <section className="sessions panel">
      <div className="panel-header sessions-header">
        <div className="sessions-title">
          <span className="brand-mark" aria-hidden="true">
            xyz
          </span>
          <span className="brand-copy">
            <strong>codex-xyz</strong>
            <small>{totalSessionLabel}</small>
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
          <SidebarSettingsMenu
            theme={theme}
            nextTheme={nextTheme}
            detailWordWrap={detailWordWrap}
            onThemeChange={onThemeChange}
            onDetailWordWrapChange={onDetailWordWrapChange}
          />
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

      <div className="session-summary" aria-label="Session summary">
        <span>
          <strong>{sessionList.visibleProjectCount}</strong> workdirs
        </span>
        <span>
          <strong>{sessionList.loadedThreadCount}</strong> loaded
        </span>
        {sessionList.queuedTaskCount > 0 ? (
          <span className="queued">
            <strong>{sessionList.queuedTaskCount}</strong> queued
          </span>
        ) : null}
        <button
          type="button"
          className="session-collapse-all"
          title={collapseAllTitle}
          aria-label={collapseAllTitle}
          aria-pressed={allVisibleProjectsCollapsed}
          disabled={sessionList.hasQuery || collapsibleProjectCount === 0}
          onClick={toggleAllProjects}
        >
          {allVisibleProjectsCollapsed ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
      </div>

      <VirtualSessionList
        density={density}
        sessionList={sessionList}
        collapsedProjectIds={collapsedProjectIds}
        runtimeIssuesByThreadId={runtimeIssuesByThreadId}
        selectedThreadId={selectedThreadId}
        loadingMoreThreads={loadingMoreThreads}
        onToggleProject={toggleProject}
        onLoadMoreThreads={onLoadMoreThreads}
        onSelectThread={onSelectThread}
      />
    </section>
  );
});
