import {
  Bot,
  Check,
  ChevronDown,
  ChevronUp,
  FileText,
  FolderOpen,
  GitFork,
  History,
  Info,
  ListChecks,
  Loader2,
  Moon,
  Plus,
  RefreshCw,
  RotateCw,
  Search,
  Send,
  Square,
  Sun,
  Target,
  Terminal,
  UserRound
} from "lucide-react";
import type { FormEvent, KeyboardEvent } from "react";
import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import {
  apiUrl,
  createProject,
  createTask,
  forkThread,
  getState,
  getThread,
  interruptTurn,
  renameThread,
  resumeThread,
  startTurn,
  steerTurn
} from "./api.js";
import { applyEventProjectionBatch, incrementalEventNames, type ClientProjection } from "./eventProjection.js";
import { getSessionListModel, selectionTouchesThreadGroup } from "./sessionList.js";
import {
  defaultTranscriptWindowThreshold,
  getTranscriptWindow,
  type TranscriptWindowMode
} from "./transcriptWindow.js";
import { getCollapsedTextPreview } from "./textPreview.js";
import { choosePreferredThreadId, shouldLoadThreadSelection, shouldSelectActionResult } from "./threadSelection.js";
import type {
  ControlThread,
  DashboardState,
  Project,
  RuntimeStatus,
  ThreadDetail,
  ThreadItem,
  XyzEvent
} from "../server/domain.js";

function statusLabel(status: string) {
  return status.replace("_", " ");
}

function statusTone(status: RuntimeStatus) {
  if (status === "running") {
    return "running";
  }
  if (status === "failed" || status === "interrupted") {
    return "attention";
  }
  if (status === "stale") {
    return "stale";
  }
  return "quiet";
}

const timeFormatter = new Intl.DateTimeFormat(undefined, {
  hour: "2-digit",
  minute: "2-digit"
});

const dateTimeFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit"
});

const standardTokenFormatter = new Intl.NumberFormat(undefined, {
  notation: "standard"
});

const compactTokenFormatter = new Intl.NumberFormat(undefined, {
  notation: "compact"
});

function formatTime(value: string) {
  return timeFormatter.format(new Date(value));
}

function formatDateTime(value: string) {
  return dateTimeFormatter.format(new Date(value));
}

function formatTokens(value: number | null | undefined) {
  if (!value) {
    return "0";
  }
  return (value >= 100_000 ? compactTokenFormatter : standardTokenFormatter).format(value);
}

function shortId(value: string) {
  return value.slice(0, 8);
}

function initialState(): DashboardState {
  return {
    projects: [],
    tasks: [],
    threads: [],
    recipes: []
  };
}

function itemTitle(item: ThreadItem) {
  const sourceType = typeof item.data.sourceType === "string" ? item.data.sourceType : null;
  if (sourceType === "reasoning") {
    return "Reasoning";
  }
  if (sourceType === "mcpToolCall") {
    return "MCP tool";
  }
  if (sourceType === "dynamicToolCall") {
    return "Tool";
  }
  if (sourceType === "webSearch") {
    return "Web search";
  }
  if (item.type === "agent") {
    return "Codex";
  }
  if (item.type === "user") {
    return "User";
  }
  if (item.type === "plan") {
    return "Plan";
  }
  if (item.type === "command") {
    return "Command";
  }
  if (item.type === "file") {
    return "Files";
  }
  return "System";
}

function itemDefaultsCollapsed(item: ThreadItem) {
  const sourceType = typeof item.data.sourceType === "string" ? item.data.sourceType : null;
  return sourceType === "reasoning" || item.type === "command";
}

function ItemIcon({ item }: { item: ThreadItem }) {
  if (item.type === "agent") {
    return <Bot size={15} />;
  }
  if (item.type === "user") {
    return <UserRound size={15} />;
  }
  if (item.type === "plan") {
    return <ListChecks size={15} />;
  }
  if (item.type === "command") {
    return <Terminal size={15} />;
  }
  if (item.type === "file") {
    return <FileText size={15} />;
  }
  return <Info size={15} />;
}

type ThemeMode = "dark" | "light";
type RunActionOptions = {
  selectResult?: boolean;
  successMessage?: string;
};

const themeStorageKey = "codex-xyz-theme";
const collapsedPreviewLineCount = 2;

type SelectThreadHandler = (threadId: string) => void | Promise<void>;
type SessionGroupProps = {
  title: string;
  threads: ControlThread[];
  selectedThreadId: string | null;
  hasQuery: boolean;
  emptyLabel: string;
  emptyQueryLabel: string;
  onSelectThread: SelectThreadHandler;
};

function readStoredTheme(): ThemeMode {
  if (typeof window === "undefined") {
    return "dark";
  }
  try {
    return window.localStorage.getItem(themeStorageKey) === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

function isGoalPrompt(value: string) {
  return /^\/goal(?:\s|$)/i.test(value.trim());
}

const SessionRow = memo(function SessionRow({
  thread,
  selected,
  onSelectThread
}: {
  thread: ControlThread;
  selected: boolean;
  onSelectThread: SelectThreadHandler;
}) {
  const hasGoal = Boolean(thread.goalObjective && thread.goalStatus && thread.goalStatus !== "cleared");
  const goalStatus = thread.goalStatus ? `Goal ${statusLabel(thread.goalStatus)}` : "Goal";

  return (
    <button
      className={`session-row ${selected ? "selected" : ""}`}
      onClick={() => {
        void onSelectThread(thread.id);
      }}
      aria-pressed={selected}
    >
      <span className="session-row-main">
        <span className={`status-dot ${thread.status}`} />
        <span className="session-copy">
          <strong>{thread.title}</strong>
          <small>{thread.preview || thread.cwd}</small>
        </span>
        <span className={`session-status ${statusTone(thread.status)}`}>{statusLabel(thread.status)}</span>
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

const SessionGroup = memo(function SessionGroup({
  title,
  threads,
  selectedThreadId,
  hasQuery,
  emptyLabel,
  emptyQueryLabel,
  onSelectThread
}: SessionGroupProps) {
  return (
    <div className="session-group">
      <h2 className="session-group-heading">
        <span>{title}</span>
        <span className="session-group-count">{threads.length}</span>
      </h2>
      {threads.length === 0 ? (
        <div className="empty-state compact">{hasQuery ? emptyQueryLabel : emptyLabel}</div>
      ) : null}
      {threads.map((thread) => (
        <SessionRow
          key={thread.id}
          thread={thread}
          selected={thread.id === selectedThreadId}
          onSelectThread={onSelectThread}
        />
      ))}
    </div>
  );
}, (previous: SessionGroupProps, next: SessionGroupProps) =>
  previous.title === next.title &&
  previous.threads === next.threads &&
  previous.hasQuery === next.hasQuery &&
  previous.emptyLabel === next.emptyLabel &&
  previous.emptyQueryLabel === next.emptyQueryLabel &&
  previous.onSelectThread === next.onSelectThread &&
  !selectionTouchesThreadGroup(next.threads, previous.selectedThreadId, next.selectedThreadId)
);

function WorkdirField({
  projects,
  value,
  matchingProject,
  disabled,
  onChange
}: {
  projects: Project[];
  value: string;
  matchingProject: Project | null;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const trimmedValue = value.trim();

  return (
    <div className="workdir-panel">
      <label className="workdir-field">
        <span className="field-label">
          <FolderOpen size={14} />
          <span>Workdir</span>
        </span>
        <input
          value={value}
          list="project-workdirs"
          onChange={(event) => onChange(event.target.value)}
          placeholder="/path/to/repo"
          disabled={disabled}
          aria-label="Working directory"
        />
      </label>
      <datalist id="project-workdirs">
        {projects.map((project) => (
          <option key={project.id} value={project.path}>
            {project.name}
          </option>
        ))}
      </datalist>
      <span className={`workdir-state ${matchingProject ? "existing" : "new"}`}>
        {trimmedValue.length === 0 ? "Required" : matchingProject ? matchingProject.name : "New project"}
      </span>
    </div>
  );
}

const SessionFacts = memo(
  function SessionFacts({ thread }: { thread: ThreadDetail }) {
    return (
      <div className="session-facts">
        <div>
          <span>Status</span>
          <strong className={`fact-status ${statusTone(thread.status)}`}>{statusLabel(thread.status)}</strong>
        </div>
        <div>
          <span>Tokens</span>
          <strong>{formatTokens(thread.tokensUsed)}</strong>
        </div>
        <div>
          <span>Turns</span>
          <strong>{thread.turns.length}</strong>
        </div>
        <div>
          <span>Model</span>
          <strong>{thread.model ?? "default"}</strong>
        </div>
        <div className="wide">
          <span>Workdir</span>
          <strong>{thread.cwd}</strong>
        </div>
        <div>
          <span>Session</span>
          <strong>{shortId(thread.sessionId)}</strong>
        </div>
        <div>
          <span>Updated</span>
          <strong>{formatDateTime(thread.updatedAt)}</strong>
        </div>
      </div>
    );
  },
  (previous, next) =>
    previous.thread.status === next.thread.status &&
    previous.thread.tokensUsed === next.thread.tokensUsed &&
    previous.thread.turns.length === next.thread.turns.length &&
    previous.thread.model === next.thread.model &&
    previous.thread.cwd === next.thread.cwd &&
    previous.thread.sessionId === next.thread.sessionId &&
    previous.thread.updatedAt === next.thread.updatedAt
);

const TranscriptItem = memo(function TranscriptItem({
  item,
  expanded,
  onToggleExpanded
}: {
  item: ThreadItem;
  expanded: boolean;
  onToggleExpanded: (itemId: string) => void;
}) {
  const status = typeof item.data.status === "string" ? item.data.status : null;
  const exitCode = typeof item.data.exitCode === "number" ? item.data.exitCode : null;
  const outputText = item.text || "Pending...";
  const textPreview = itemDefaultsCollapsed(item)
    ? getCollapsedTextPreview(outputText, {
        expanded,
        lineCount: collapsedPreviewLineCount
      })
    : {
        canCollapse: false,
        visibleText: outputText
      };
  const canCollapse = textPreview.canCollapse;
  const visibleText = textPreview.visibleText;
  const title = itemTitle(item);

  return (
    <article className={`transcript-item ${item.type}`}>
      <div className="item-meta">
        <span className="item-title">
          <ItemIcon item={item} />
          <span>{title}</span>
        </span>
        <span className="item-meta-right">
          {status ? <span className="item-chip">{status}</span> : null}
          {exitCode !== null ? <span className="item-chip">exit {exitCode}</span> : null}
          {canCollapse ? (
            <button
              type="button"
              className="item-expand"
              aria-expanded={expanded}
              aria-label={`${expanded ? "Collapse" : "Expand"} ${title}`}
              onClick={() => onToggleExpanded(item.id)}
            >
              {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              <span>{expanded ? "Collapse" : "Expand"}</span>
            </button>
          ) : null}
          <time>{formatTime(item.createdAt)}</time>
        </span>
      </div>
      <pre>{visibleText}</pre>
    </article>
  );
});

const Transcript = memo(function Transcript({
  detail,
  hasSelection
}: {
  detail: ThreadDetail | null;
  hasSelection: boolean;
}) {
  const [expandedItemIds, setExpandedItemIds] = useState<Set<string>>(() => new Set());
  const [windowMode, setWindowMode] = useState<TranscriptWindowMode>("recent");

  useEffect(() => {
    setExpandedItemIds(new Set());
    setWindowMode("recent");
  }, [detail?.id]);

  const toggleExpandedItem = useCallback((itemId: string) => {
    setExpandedItemIds((current) => {
      const next = new Set(current);
      if (next.has(itemId)) {
        next.delete(itemId);
      } else {
        next.add(itemId);
      }
      return next;
    });
  }, []);

  const transcriptWindow = useMemo(
    () => getTranscriptWindow(detail?.items ?? [], windowMode),
    [detail?.items, windowMode]
  );
  const showWindowControls = Boolean(detail && detail.items.length > defaultTranscriptWindowThreshold);
  const windowSummary =
    windowMode === "recent" && transcriptWindow.isWindowed
      ? `${transcriptWindow.visibleCount} / ${transcriptWindow.totalCount} items`
      : `${transcriptWindow.totalCount} items`;

  return (
    <div className="transcript" aria-label="Session transcript">
      {!detail ? <div className="empty-state">{hasSelection ? "Loading session..." : "No session selected"}</div> : null}
      {detail?.items.length === 0 ? <div className="empty-state">No transcript items yet</div> : null}
      {showWindowControls ? (
        <div className="transcript-window-bar">
          <span>{windowSummary}</span>
          <div className="transcript-window-mode" role="group" aria-label="Transcript range">
            <button
              type="button"
              className={windowMode === "recent" ? "active" : ""}
              aria-pressed={windowMode === "recent"}
              onClick={() => setWindowMode("recent")}
            >
              Recent
            </button>
            <button
              type="button"
              className={windowMode === "all" ? "active" : ""}
              aria-pressed={windowMode === "all"}
              onClick={() => setWindowMode("all")}
            >
              All
            </button>
          </div>
        </div>
      ) : null}
      {transcriptWindow.items.map((item) => (
        <TranscriptItem
          key={item.id}
          item={item}
          expanded={expandedItemIds.has(item.id)}
          onToggleExpanded={toggleExpandedItem}
        />
      ))}
    </div>
  );
});

export function App() {
  const [state, setState] = useState<DashboardState>(initialState);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ThreadDetail | null>(null);
  const [prompt, setPrompt] = useState("");
  const [steer, setSteer] = useState("");
  const [workdir, setWorkdir] = useState("");
  const [workdirTouched, setWorkdirTouched] = useState(false);
  const [sessionQuery, setSessionQuery] = useState("");
  const [composerMode, setComposerMode] = useState<"thread" | "new">("thread");
  const [renameTitle, setRenameTitle] = useState("");
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [theme, setTheme] = useState<ThemeMode>(readStoredTheme);
  const selectedThreadIdRef = useRef<string | null>(null);
  const manualSelectionSeqRef = useRef(0);
  const refreshSeqRef = useRef(0);
  const detailLoadSeqRef = useRef(0);
  const lastEventIdRef = useRef(0);
  const pendingEventsRef = useRef<XyzEvent[]>([]);
  const projectionFrameRef = useRef<number | null>(null);
  const projectionRef = useRef<ClientProjection>({
    state: initialState(),
    detail: null
  });

  const busy = busyAction !== null;
  const nextTheme = theme === "dark" ? "light" : "dark";

  function beginRefresh() {
    refreshSeqRef.current += 1;
    beginDetailLoad();
    return refreshSeqRef.current;
  }

  function refreshIsCurrent(refreshSeq: number) {
    return refreshSeqRef.current === refreshSeq;
  }

  function beginManualSelection() {
    manualSelectionSeqRef.current += 1;
    refreshSeqRef.current += 1;
  }

  function beginDetailLoad() {
    detailLoadSeqRef.current += 1;
    return detailLoadSeqRef.current;
  }

  function detailLoadIsCurrent(threadId: string, loadSeq: number) {
    return detailLoadSeqRef.current === loadSeq && selectedThreadIdRef.current === threadId;
  }

  function commitDetailLoad(threadId: string, nextDetail: ThreadDetail, loadSeq: number) {
    if (!detailLoadIsCurrent(threadId, loadSeq)) {
      return false;
    }
    projectionRef.current = {
      state: projectionRef.current.state,
      detail: nextDetail
    };
    setDetail(nextDetail);
    return true;
  }

  function clearDetailForSelection(threadId: string) {
    if (projectionRef.current.detail?.id === threadId) {
      return;
    }
    projectionRef.current = {
      state: projectionRef.current.state,
      detail: null
    };
    setDetail(null);
  }

  async function refresh(nextThreadId?: string | null) {
    const refreshSeq = beginRefresh();
    const requestedThreadId = nextThreadId ?? selectedThreadIdRef.current;
    const shouldPreferRequestedThread = typeof nextThreadId === "string";
    const next = await getState();
    if (!refreshIsCurrent(refreshSeq)) {
      return;
    }
    setState(next);
    projectionRef.current = {
      ...projectionRef.current,
      state: next
    };
    const preferredThreadId = choosePreferredThreadId(next.threads, {
      currentThreadId: selectedThreadIdRef.current,
      requestedThreadId,
      preferRequestedThread: shouldPreferRequestedThread
    });
    setSelectedThreadId(preferredThreadId);
    selectedThreadIdRef.current = preferredThreadId;
    if (preferredThreadId) {
      clearDetailForSelection(preferredThreadId);
      const loadSeq = beginDetailLoad();
      try {
        const nextDetail = await getThread(preferredThreadId);
        if (refreshIsCurrent(refreshSeq)) {
          commitDetailLoad(preferredThreadId, nextDetail, loadSeq);
        }
      } catch (detailError) {
        if (refreshIsCurrent(refreshSeq) && detailLoadIsCurrent(preferredThreadId, loadSeq)) {
          throw detailError;
        }
      }
    } else {
      beginDetailLoad();
      projectionRef.current = {
        state: next,
        detail: null
      };
      setDetail(null);
    }
  }

  const selectThread = useCallback(async (threadId: string) => {
    beginManualSelection();
    const shouldLoadDetail = shouldLoadThreadSelection(threadId, {
      currentThreadId: selectedThreadIdRef.current,
      currentDetailThreadId: projectionRef.current.detail?.id ?? null
    });
    setComposerMode("thread");
    setError(null);
    if (!shouldLoadDetail) {
      return;
    }
    setSelectedThreadId(threadId);
    selectedThreadIdRef.current = threadId;
    clearDetailForSelection(threadId);
    const loadSeq = beginDetailLoad();
    try {
      const nextDetail = await getThread(threadId);
      commitDetailLoad(threadId, nextDetail, loadSeq);
    } catch (selectError) {
      if (detailLoadIsCurrent(threadId, loadSeq)) {
        setError(selectError instanceof Error ? selectError.message : "Failed to load session");
      }
    }
  }, []);

  useEffect(() => {
    void refresh().catch((loadError: unknown) => {
      setError(loadError instanceof Error ? loadError.message : "Failed to load state");
    });
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      window.localStorage.setItem(themeStorageKey, theme);
    } catch {
      // Keep the in-memory theme even if the browser blocks persistence.
    }
  }, [theme]);

  useEffect(() => {
    let source: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let fallbackRefreshTimer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;

    const scheduleFallbackRefresh = () => {
      if (fallbackRefreshTimer) {
        return;
      }
      fallbackRefreshTimer = setTimeout(() => {
        fallbackRefreshTimer = null;
        void refresh();
      }, 250);
    };

    const flushProjectionEvents = () => {
      projectionFrameRef.current = null;
      const events = pendingEventsRef.current;
      if (events.length === 0) {
        return;
      }
      pendingEventsRef.current = [];
      const next = applyEventProjectionBatch(projectionRef.current, events);
      const previous = projectionRef.current;
      projectionRef.current = {
        state: next.state,
        detail: next.detail
      };
      if (next.changed) {
        if (next.state !== previous.state) {
          setState(next.state);
        }
        if (next.detail !== previous.detail) {
          setDetail(next.detail);
        }
      }
      if (!next.handled || next.needsRefresh) {
        scheduleFallbackRefresh();
      }
    };

    const scheduleProjectionFlush = () => {
      if (projectionFrameRef.current !== null) {
        return;
      }
      projectionFrameRef.current = window.requestAnimationFrame(flushProjectionEvents);
    };

    const handleEvent = (rawEvent: Event) => {
      const message = rawEvent as MessageEvent<string>;
      try {
        const event = JSON.parse(message.data) as XyzEvent;
        lastEventIdRef.current = Math.max(lastEventIdRef.current, event.id);
        pendingEventsRef.current.push(event);
        scheduleProjectionFlush();
      } catch {
        scheduleFallbackRefresh();
      }
    };

    function connect() {
      const after = lastEventIdRef.current;
      source = new EventSource(apiUrl(after > 0 ? `/api/events?after=${after}` : "/api/events"));
      source.onmessage = handleEvent;
      for (const eventName of incrementalEventNames) {
        source.addEventListener(eventName, handleEvent);
      }
      source.onerror = () => {
        source?.close();
        if (!disposed) {
          reconnectTimer = setTimeout(connect, 1200);
        }
      };
    }

    connect();
    return () => {
      disposed = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
      }
      if (fallbackRefreshTimer) {
        clearTimeout(fallbackRefreshTimer);
      }
      if (projectionFrameRef.current !== null) {
        window.cancelAnimationFrame(projectionFrameRef.current);
        projectionFrameRef.current = null;
      }
      pendingEventsRef.current = [];
      source?.close();
    };
  }, []);

  const selectedThread = useMemo(
    () => state.threads.find((thread) => thread.id === selectedThreadId) ?? null,
    [selectedThreadId, state.threads]
  );
  const selectedDetail = detail?.id === selectedThreadId ? detail : null;
  const deferredSessionQuery = useDeferredValue(sessionQuery);
  const matchingWorkdirProject = useMemo(() => {
    const trimmed = workdir.trim();
    return state.projects.find((project) => project.path === trimmed) ?? null;
  }, [state.projects, workdir]);

  const sessionList = useMemo(
    () => getSessionListModel(state.threads, state.tasks, deferredSessionQuery),
    [deferredSessionQuery, state.tasks, state.threads]
  );
  const sessionCountLabel =
    sessionList.visibleThreadCount === sessionList.totalThreadCount
      ? `${sessionList.totalThreadCount} total`
      : `${sessionList.visibleThreadCount} / ${sessionList.totalThreadCount} shown`;
  const promptTarget = composerMode === "thread" && selectedThread ? "thread" : "new";
  const trimmedWorkdir = workdir.trim();
  const goalPrompt = isGoalPrompt(prompt);
  const canSubmitPrompt =
    Boolean(prompt.trim()) &&
    !busy &&
    (goalPrompt
      ? Boolean(selectedThreadId)
      : promptTarget === "thread"
        ? Boolean(selectedThreadId)
        : Boolean(trimmedWorkdir));
  const canSubmitSteer =
    Boolean(selectedThreadId) && selectedThread?.status === "running" && Boolean(steer.trim()) && !busy;
  const canRename =
    Boolean(selectedThreadId) &&
    Boolean(renameTitle.trim()) &&
    renameTitle.trim() !== selectedThread?.title &&
    !busy;
  useEffect(() => {
    if (!workdirTouched && workdir.length === 0 && state.projects[0]) {
      setWorkdir(state.projects[0].path);
    }
  }, [state.projects, workdir, workdirTouched]);

  useEffect(() => {
    setRenameTitle(selectedThread?.title ?? "");
  }, [selectedThread?.id, selectedThread?.title]);

  function updateWorkdir(value: string) {
    setWorkdir(value);
    setWorkdirTouched(true);
  }

  async function runAction(
    label: string,
    action: () => Promise<unknown>,
    options: RunActionOptions = {}
  ) {
    const actionSelectionSeq = manualSelectionSeqRef.current;
    setBusyAction(label);
    setError(null);
    setNotice(null);
    try {
      const nextThreadId = await action();
      if (
        shouldSelectActionResult(nextThreadId, {
          selectResult: options.selectResult,
          actionSelectionSeq,
          currentSelectionSeq: manualSelectionSeqRef.current
        })
      ) {
        await refresh(nextThreadId);
      } else {
        await refresh();
      }
      if (options.successMessage) {
        setNotice(options.successMessage);
      }
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Action failed");
    } finally {
      setBusyAction(null);
    }
  }

  function executePrompt() {
    if (!canSubmitPrompt) {
      return;
    }
    const currentPrompt = prompt;

    if (isGoalPrompt(currentPrompt)) {
      if (!selectedThreadId) {
        setError("Select a session before using /goal.");
        return;
      }
      const threadId = selectedThreadId;
      setPrompt("");
      setComposerMode("thread");
      void runAction("Starting goal turn", async () => {
        const turn = await startTurn(threadId, currentPrompt);
        return turn.threadId;
      });
      return;
    }

    setPrompt("");

    if (promptTarget === "thread" && selectedThreadId) {
      const threadId = selectedThreadId;
      void runAction("Starting turn", async () => {
        const turn = await startTurn(threadId, currentPrompt);
        return turn.threadId;
      });
      return;
    }

    void runAction(
      "Creating session",
      async () => {
        let project = matchingWorkdirProject;
        if (!project) {
          project = await createProject({ path: trimmedWorkdir });
        }
        setWorkdir(project.path);
        setWorkdirTouched(false);
        const result = await createTask({ projectId: project.id, prompt: currentPrompt });
        const thread = result.thread as { id?: string } | null;
        setComposerMode("thread");
        return thread?.id;
      },
      { selectResult: true }
    );
  }

  function submitPrompt(event: FormEvent) {
    event.preventDefault();
    executePrompt();
  }

  function handlePromptKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && event.metaKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      executePrompt();
    }
  }

  function submitSteer(event: FormEvent) {
    event.preventDefault();
    if (!selectedThreadId || !canSubmitSteer) {
      return;
    }
    const threadId = selectedThreadId;
    const currentSteer = steer;
    setSteer("");
    void runAction("Steering turn", async () => {
      await steerTurn(threadId, currentSteer);
    });
  }

  function submitRename(event: FormEvent) {
    event.preventDefault();
    if (!selectedThreadId || !canRename) {
      return;
    }
    const threadId = selectedThreadId;
    const title = renameTitle.trim();
    void runAction(
      "Renaming session",
      async () => {
        await renameThread(threadId, title);
      },
      { successMessage: "Session renamed" }
    );
  }

  return (
    <main className="workspace" data-theme={theme}>
      <section className="sessions panel">
        <div className="panel-header sessions-header">
          <div className="sessions-title">
            <strong>codex-xyz</strong>
            <h1>Sessions</h1>
            <p>
              {sessionCountLabel}, {sessionList.queuedTaskCount} active tasks
            </p>
          </div>
          <div className="panel-header-actions">
            {busy ? <Loader2 className="spin" size={18} /> : <History size={18} />}
            <button
              type="button"
              className="theme-toggle"
              title={`Switch to ${nextTheme} mode`}
              aria-label={`Switch to ${nextTheme} mode`}
              aria-pressed={theme === "light"}
              onClick={() => setTheme(nextTheme)}
            >
              {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
            </button>
            <button title="Refresh" aria-label="Refresh" onClick={() => void refresh()}>
              <RefreshCw size={16} />
            </button>
          </div>
        </div>

        <div className="composer-mode" role="group" aria-label="Prompt target">
          <button
            type="button"
            className={promptTarget === "new" ? "active" : ""}
            title="New session"
            onClick={() => setComposerMode("new")}
          >
            <Plus size={15} />
            <span>New session</span>
          </button>
          <button
            type="button"
            className={promptTarget === "thread" ? "active" : ""}
            title="Selected session"
            disabled={!selectedThreadId}
            onClick={() => setComposerMode("thread")}
          >
            <Send size={15} />
            <span>Selected</span>
          </button>
        </div>

        <div className="composer-stack">
          {promptTarget === "new" ? (
            <WorkdirField
              projects={state.projects}
              value={workdir}
              matchingProject={matchingWorkdirProject}
              disabled={busy}
              onChange={updateWorkdir}
            />
          ) : null}

          <form className="task-form" onSubmit={submitPrompt}>
            <textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              onKeyDown={handlePromptKeyDown}
              placeholder={promptTarget === "thread" ? "Send next turn or /goal <objective>" : "Create a task"}
              disabled={busy}
            />
            <button
              disabled={!canSubmitPrompt}
              title={goalPrompt ? "Start goal turn" : promptTarget === "thread" ? "Start turn" : "Create session"}
            >
              {goalPrompt ? <Target size={16} /> : promptTarget === "thread" ? <Send size={16} /> : <Plus size={16} />}
            </button>
          </form>

          {selectedThread ? (
            <form className="steer-form" onSubmit={submitSteer}>
              <input
                value={steer}
                onChange={(event) => setSteer(event.target.value)}
                placeholder="Steer active turn"
                disabled={!selectedThreadId || selectedThread.status !== "running" || busy}
                aria-label="Steer active turn"
              />
              <button title="Steer active turn" disabled={!canSubmitSteer}>
                <Send size={16} />
              </button>
            </form>
          ) : null}
        </div>

        {busyAction ? <div className="status-banner neutral">{busyAction}...</div> : null}
        {notice ? <div className="status-banner success">{notice}</div> : null}
        {error ? <div className="status-banner error">{error}</div> : null}

        <label className="session-search">
          <Search size={14} />
          <input
            value={sessionQuery}
            onChange={(event) => setSessionQuery(event.target.value)}
            placeholder="Search sessions"
            aria-label="Search sessions"
          />
        </label>

        <div className="session-list" aria-label="Session list">
          <SessionGroup
            title="Active"
            threads={sessionList.activeThreads}
            selectedThreadId={selectedThreadId}
            hasQuery={sessionList.hasQuery}
            emptyLabel="No active sessions"
            emptyQueryLabel="No matching active sessions"
            onSelectThread={selectThread}
          />

          <SessionGroup
            title="Needs attention"
            threads={sessionList.attentionThreads}
            selectedThreadId={selectedThreadId}
            hasQuery={sessionList.hasQuery}
            emptyLabel="No attention needed"
            emptyQueryLabel="No matching attention"
            onSelectThread={selectThread}
          />

          <SessionGroup
            title="History"
            threads={sessionList.otherThreads}
            selectedThreadId={selectedThreadId}
            hasQuery={sessionList.hasQuery}
            emptyLabel="No history"
            emptyQueryLabel="No matching history"
            onSelectThread={selectThread}
          />
        </div>
      </section>

      <section className="detail panel">
        <div className="detail-header">
          <div className="title-stack">
            {selectedThread ? (
              <form className="title-editor" onSubmit={submitRename}>
                <input
                  value={renameTitle}
                  onChange={(event) => setRenameTitle(event.target.value)}
                  disabled={busy}
                  aria-label="Session title"
                />
                <button title="Save title" disabled={!canRename}>
                  <Check size={16} />
                </button>
              </form>
            ) : (
              <h1>Session</h1>
            )}
            <p>{selectedThread ? `${statusLabel(selectedThread.status)} · ${formatDateTime(selectedThread.updatedAt)}` : "idle"}</p>
          </div>
          <div className="toolbar">
            <button
              title="Interrupt"
              disabled={!selectedThreadId || selectedThread?.status !== "running" || busy}
              onClick={() =>
                selectedThreadId &&
                void runAction("Interrupting turn", async () => {
                  await interruptTurn(selectedThreadId);
                })
              }
            >
              <Square size={16} />
              <span>Interrupt</span>
            </button>
            <button
              title="Resume"
              disabled={!selectedThreadId || selectedThread?.status === "running" || busy}
              onClick={() =>
                selectedThreadId &&
                void runAction(
                  "Resuming session",
                  async () => {
                    const thread = await resumeThread(selectedThreadId);
                    return thread.id;
                  },
                  { successMessage: "Session resumed" }
                )
              }
            >
              <RotateCw size={16} />
              <span>Resume</span>
            </button>
            <button
              title="Fork"
              disabled={!selectedThreadId || busy}
              onClick={() =>
                selectedThreadId &&
                void runAction(
                  "Forking session",
                  async () => {
                    const thread = await forkThread(selectedThreadId);
                    return thread.id;
                  },
                  { selectResult: true }
                )
              }
            >
              <GitFork size={16} />
              <span>Fork</span>
            </button>
          </div>
        </div>

        {selectedDetail ? <SessionFacts thread={selectedDetail} /> : null}

        <Transcript detail={selectedDetail} hasSelection={Boolean(selectedThreadId)} />
      </section>
    </main>
  );
}
