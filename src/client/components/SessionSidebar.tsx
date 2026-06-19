import {
  Check,
  ChevronDown,
  ChevronRight,
  FolderOpen,
  Loader2,
  Moon,
  Search,
  Settings,
  SidebarClose,
  Target,
  Terminal,
  WrapText
} from "lucide-react";
import type { FocusEvent, KeyboardEvent } from "react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ControlThread } from "../../server/domain.js";
import {
  activeIconButtonClass,
  cn,
  iconButtonClass,
  pillClass,
  statusDotClass,
  statusToneClass,
  subtleIconButtonClass
} from "../classNames.js";
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
  selectedThreadId: string | null;
  loadingMoreThreads: boolean;
  onSidebarToggle?: () => void;
  onTerminalToggle: () => void;
  onThemeChange: (theme: ThemeMode) => void;
  onDetailWordWrapChange: (enabled: boolean) => void;
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

const projectChipClass = {
  running: "border-transparent bg-running px-1.5 text-running-fg",
  attention: "border-transparent bg-attention px-1.5 text-attention-fg",
  count: "border-border-soft bg-chip px-1.5 text-chip-fg"
} as const;

const goalClass = {
  in_progress: "border-running/40 bg-running text-running-fg",
  paused: "border-stale/40 bg-stale text-stale-fg",
  blocked: "border-attention/40 bg-attention text-attention-fg",
  usage_limited: "border-attention/40 bg-attention text-attention-fg",
  budget_limited: "border-attention/40 bg-attention text-attention-fg",
  complete: "border-running/40 bg-running text-running-fg",
  cleared: "border-border-soft bg-chip text-chip-fg"
} as const;

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
      className={cn(
        "group flex h-full w-full items-center gap-2 rounded-md px-2 text-left transition duration-200 ease-snappy hover:bg-control-hover",
        containsSelected ? "bg-accent-soft text-fg-strong" : "text-muted-strong"
      )}
      aria-expanded={!collapsed}
      title={projectHeadingTitle(group)}
      onClick={() => onToggleProject(group.id)}
    >
      <span className="flex h-5 w-5 shrink-0 items-center justify-center text-muted transition group-hover:text-fg" aria-hidden="true">
        {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
      </span>
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-border-soft bg-surface-subtle text-muted-strong shadow-control" aria-hidden="true">
        <FolderOpen size={15} />
      </span>
      <span className="min-w-0 flex-1">
        <strong className="block truncate text-[13px] font-semibold leading-5 text-fg-strong">{group.name}</strong>
        <small className="block truncate text-[11px] leading-4 text-muted">{group.path}</small>
      </span>
      <span className="flex shrink-0 items-center gap-1 text-[11px] text-muted">
        {group.runningCount > 0 ? <span className={cn("rounded-full border font-medium leading-5", projectChipClass.running)}>{group.runningCount}</span> : null}
        {group.attentionCount > 0 ? <span className={cn("rounded-full border font-medium leading-5", projectChipClass.attention)}>{group.attentionCount}</span> : null}
        <span className={cn("rounded-full border font-medium leading-5", projectChipClass.count)}>{group.threadCount}</span>
        <time className="hidden max-w-[72px] truncate md:inline" dateTime={group.updatedAt} title={`Updated ${updatedAt}`}>
          {updatedAt}
        </time>
      </span>
    </button>
  );
});

const SessionRow = memo(function SessionRow({
  thread,
  selected,
  onSelectThread
}: {
  thread: ControlThread;
  selected: boolean;
  onSelectThread: SelectThreadHandler;
}) {
  const hasGoal = threadHasGoal(thread);
  const goalStatus = thread.goalStatus ? `Goal ${statusLabel(thread.goalStatus)}` : "Goal";
  const visibleStatus = statusLabel(thread.status);
  const visiblePreview = thread.preview || thread.model || thread.cwd;
  const visibleUpdatedAt = formatDateTime(thread.updatedAt);
  const rowTitle = `${thread.preview || thread.cwd || thread.title}\nUpdated ${visibleUpdatedAt}`;

  return (
    <button
      className={cn(
        "group flex h-full w-full flex-col justify-center gap-1 rounded-md px-2.5 py-1.5 text-left transition duration-200 ease-snappy hover:bg-control-hover",
        selected ? "bg-accent-soft text-fg-strong ring-1 ring-border shadow-control" : "text-fg"
      )}
      onClick={() => {
        void onSelectThread(thread.id);
      }}
      aria-pressed={selected}
      title={rowTitle}
    >
      <span className="flex min-w-0 items-start gap-2">
        <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full ring-2 ring-app-panel", statusDotClass[thread.status])} />
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-2">
            <strong className="min-w-0 flex-1 truncate text-[13px] font-semibold leading-5 text-fg-strong">{thread.title}</strong>
            <time className="shrink-0 text-[11px] leading-4 text-muted" dateTime={thread.updatedAt} title={`Updated ${visibleUpdatedAt}`}>
              {visibleUpdatedAt}
            </time>
          </span>
          <span className="flex min-w-0 items-center gap-2">
            <small className="min-w-0 flex-1 truncate text-[11px] leading-4 text-muted">{visiblePreview}</small>
            <span className={cn("rounded-md px-1.5 py-0.5 text-[10px] font-medium leading-none", statusToneClass[statusTone(thread.status)])}>{visibleStatus}</span>
          </span>
        </span>
      </span>
      {hasGoal ? (
        <span
          className={cn(
            "flex min-w-0 items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] shadow-control",
            thread.goalStatus ? goalClass[thread.goalStatus] : "border-border-soft bg-chip text-chip-fg"
          )}
          title={thread.goalObjective ?? undefined}
        >
          <Target size={13} />
          <span className="min-w-0 flex-1">
            <strong className="block truncate font-semibold leading-4">{goalStatus}</strong>
            <small className="block truncate text-current opacity-80">{thread.goalObjective}</small>
          </span>
          {thread.goalTokenBudget ? (
            <span className="shrink-0 rounded-full bg-black/10 px-1.5 py-0.5 text-[10px] font-medium dark:bg-white/10">
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
  selectedThreadId,
  loadingMoreThreads,
  onToggleProject,
  onLoadMoreThreads,
  onSelectThread
}: {
  density: SessionListDensity;
  sessionList: SessionListModel;
  collapsedProjectIds: ReadonlySet<string>;
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
      className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-2 pb-3"
      aria-label="Session list"
      onScroll={handleScroll}
    >
      <div className="relative" style={{ height: totalHeight }}>
        {entries.slice(visibleRange.first, visibleRange.last).map((entry, localIndex) => {
          const index = visibleRange.first + localIndex;
          const top = offsets[index] ?? 0;
          const height = sessionEntryHeight(entry, density);
          return (
            <div
              key={entry.id}
              className="absolute inset-x-0 px-1"
              style={{ height, transform: `translateY(${top}px)` }}
            >
              {entry.kind === "empty" ? <div className="flex h-full items-center justify-center rounded-md border border-dashed border-border-soft bg-surface-subtle/45 text-sm text-muted">{entry.label}</div> : null}
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
                  selected={entry.thread.id === selectedThreadId}
                  onSelectThread={onSelectThread}
                />
              ) : null}
              {entry.kind === "loadMore" ? (
                <button
                  type="button"
                  className="h-9 w-full rounded-md border border-border-soft bg-surface-subtle px-3 text-sm text-muted-strong shadow-control transition duration-200 ease-snappy hover:border-border hover:bg-control-hover disabled:cursor-wait disabled:opacity-70"
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
    <div className="relative" onBlur={handleBlur} onKeyDown={handleKeyDown}>
      <button
        type="button"
        className={cn(iconButtonClass, open ? activeIconButtonClass : null)}
        title="Settings"
        aria-label="Settings"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <Settings size={16} />
      </button>
      {open ? (
        <div className="absolute right-0 top-10 z-40 w-48 rounded-lg border border-border bg-surface/95 p-1 shadow-popover backdrop-blur-xl" role="menu" aria-label="Settings">
          <button
            type="button"
            className={cn(
              "flex h-9 w-full items-center gap-2 rounded-md px-2 text-left text-sm text-muted-strong transition duration-200 ease-snappy hover:bg-control-hover hover:text-fg-strong",
              theme === "dark" ? "bg-accent-soft text-fg-strong" : null
            )}
            role="menuitemcheckbox"
            aria-checked={theme === "dark"}
            onClick={() => onThemeChange(nextTheme)}
          >
            <Moon size={15} />
            <span>Dark mode</span>
            <span className="ml-auto flex h-5 w-5 items-center justify-center" aria-hidden="true">
              {theme === "dark" ? <Check size={15} /> : null}
            </span>
          </button>
          <button
            type="button"
            className={cn(
              "flex h-9 w-full items-center gap-2 rounded-md px-2 text-left text-sm text-muted-strong transition duration-200 ease-snappy hover:bg-control-hover hover:text-fg-strong",
              detailWordWrap ? "bg-accent-soft text-fg-strong" : null
            )}
            role="menuitemcheckbox"
            aria-checked={detailWordWrap}
            onClick={() => onDetailWordWrapChange(!detailWordWrap)}
          >
            <WrapText size={15} />
            <span>Word wrap</span>
            <span className="ml-auto flex h-5 w-5 items-center justify-center" aria-hidden="true">
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
  selectedThreadId,
  loadingMoreThreads,
  onSidebarToggle,
  onTerminalToggle,
  onThemeChange,
  onDetailWordWrapChange,
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
    <section className="flex min-h-0 flex-col border-r border-border-soft bg-app-panel md:rounded-lg md:border md:shadow-panel">
      <div className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border-soft px-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border-strong bg-fg-strong text-[11px] font-bold lowercase tracking-normal text-app-panel shadow-control" aria-hidden="true">
            xyz
          </span>
          <span className="min-w-0">
            <strong className="block truncate text-sm font-semibold leading-5 text-fg-strong">codex-xyz</strong>
            <small className="block truncate text-[11px] leading-4 text-muted">{totalSessionLabel}</small>
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {busy ? <Loader2 className="animate-spin text-muted" size={18} /> : null}
          {onSidebarToggle ? (
            <button
              type="button"
              className={iconButtonClass}
              title="Hide sidebar"
              aria-label="Hide sidebar"
              onClick={onSidebarToggle}
            >
              <SidebarClose size={16} />
            </button>
          ) : null}
          <button
            type="button"
            className={cn(iconButtonClass, terminalVisible ? activeIconButtonClass : null)}
            title={terminalVisible ? "Hide terminal" : "Open terminal"}
            aria-label={terminalVisible ? "Hide terminal" : "Open terminal"}
            aria-pressed={terminalVisible}
            onClick={onTerminalToggle}
          >
            <Terminal size={16} />
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

      <label className="mx-3 mt-3 flex h-9 shrink-0 items-center gap-2 rounded-md border border-border-soft bg-field px-2.5 text-muted shadow-control transition duration-200 ease-snappy focus-within:border-border-strong focus-within:bg-surface">
        <Search size={14} className="shrink-0" />
        <input
          className="min-w-0 flex-1 border-0 bg-transparent text-sm text-fg-strong placeholder:text-muted focus:outline-none"
          value={sessionQuery}
          onChange={(event) => onSessionQueryChange(event.target.value)}
          placeholder="Search sessions"
          aria-label="Search sessions"
        />
      </label>

      <div className="flex h-10 shrink-0 items-center gap-2 px-3 text-[11px] text-muted" aria-label="Session summary">
        <span className={pillClass}>
          <strong>{sessionList.visibleProjectCount}</strong> workdirs
        </span>
        <span className={pillClass}>
          <strong>{sessionList.loadedThreadCount}</strong> loaded
        </span>
        <button
          type="button"
          className={cn(subtleIconButtonClass, "ml-auto h-7 min-w-7")}
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
        selectedThreadId={selectedThreadId}
        loadingMoreThreads={loadingMoreThreads}
        onToggleProject={toggleProject}
        onLoadMoreThreads={onLoadMoreThreads}
        onSelectThread={onSelectThread}
      />
    </section>
  );
});
