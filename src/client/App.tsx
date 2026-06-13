import type { FormEvent, KeyboardEvent } from "react";
import { lazy, Suspense, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import {
  apiUrl,
  clearGoal,
  createProject,
  createTask,
  forkThread,
  getState,
  getThread,
  getThreadsPage,
  interruptTurn,
  queueTurn,
  renameThread,
  resumeThread,
  setGoalStatus,
  startGoal,
  startTurn
} from "./api.js";
import { MobileNavigation } from "./components/MobileNavigation.js";
import { PromptComposer } from "./components/PromptComposer.js";
import { SessionSidebar } from "./components/SessionSidebar.js";
import { ThreadDetailView } from "./components/ThreadDetailView.js";
import type { ComposerMode, MobileView, ThemeMode } from "./components/types.js";
import { applyEventProjectionBatch, incrementalEventNames, type ClientProjection } from "./eventProjection.js";
import { getSessionListModel } from "./sessionList.js";
import { isMacTerminalToggleShortcut } from "./terminalShortcut.js";
import { choosePreferredThreadId, shouldLoadThreadSelection, shouldSelectActionResult } from "./threadSelection.js";
import type { DashboardState, ThreadDetail, XyzEvent } from "../server/domain.js";

function initialState(): DashboardState {
  return {
    projects: [],
    tasks: [],
    threads: [],
    threadTotalCount: 0,
    threadPageSize: 50,
    threadNextOffset: 0,
    threadHasMore: false,
    recipes: [],
    latestEventId: 0
  };
}

type RunActionOptions = {
  selectResult?: boolean;
  successMessage?: string;
  mobileViewOnSuccess?: MobileView;
};

type DetailSubscription = {
  threadId: string;
  after: number;
};

function mergeThreadsById(current: DashboardState["threads"], incoming: DashboardState["threads"]) {
  const next = [...current];
  const indexById = new Map(current.map((thread, index) => [thread.id, index]));
  for (const thread of incoming) {
    const index = indexById.get(thread.id);
    if (index === undefined) {
      indexById.set(thread.id, next.length);
      next.push(thread);
    } else {
      next[index] = thread;
    }
  }
  return next;
}

const themeStorageKey = "codex-xyz-theme";
const terminalVisibleStorageKey = "codex-xyz-terminal-visible";
const mobileViewportQuery = "(max-width: 720px)";
const TerminalDock = lazy(async () => ({
  default: (await import("./TerminalDock.js")).TerminalDock
}));

function readMediaQuery(query: string) {
  if (typeof window === "undefined") {
    return false;
  }
  return window.matchMedia(query).matches;
}

function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(() => readMediaQuery(query));

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const media = window.matchMedia(query);
    const syncMatches = () => setMatches(media.matches);

    syncMatches();
    media.addEventListener("change", syncMatches);
    return () => {
      media.removeEventListener("change", syncMatches);
    };
  }, [query]);

  return matches;
}

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

function readStoredTerminalVisible() {
  if (typeof window === "undefined") {
    return false;
  }
  try {
    return window.localStorage.getItem(terminalVisibleStorageKey) === "true";
  } catch {
    return false;
  }
}

export function App() {
  const [state, setState] = useState<DashboardState>(initialState);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ThreadDetail | null>(null);
  const [prompt, setPrompt] = useState("");
  const [queueMode, setQueueMode] = useState(false);
  const [goalMode, setGoalMode] = useState(false);
  const [workdir, setWorkdir] = useState("");
  const [workdirTouched, setWorkdirTouched] = useState(false);
  const [sessionQuery, setSessionQuery] = useState("");
  const [composerMode, setComposerMode] = useState<ComposerMode>("thread");
  const [renameTitle, setRenameTitle] = useState("");
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [theme, setTheme] = useState<ThemeMode>(readStoredTheme);
  const [terminalVisible, setTerminalVisible] = useState(readStoredTerminalVisible);
  const [mobileView, setMobileView] = useState<MobileView>("sessions");
  const [summaryEventsReady, setSummaryEventsReady] = useState(false);
  const [detailSubscription, setDetailSubscription] = useState<DetailSubscription | null>(null);
  const [loadingMoreThreads, setLoadingMoreThreads] = useState(false);
  const isMobileViewport = useMediaQuery(mobileViewportQuery);
  const isMobileViewportRef = useRef(isMobileViewport);
  const loadingMoreThreadsRef = useRef(false);
  const selectedThreadIdRef = useRef<string | null>(null);
  const manualSelectionSeqRef = useRef(0);
  const refreshSeqRef = useRef(0);
  const detailLoadSeqRef = useRef(0);
  const summaryEventIdRef = useRef(0);
  const detailEventIdRef = useRef(0);
  const pendingEventsRef = useRef<XyzEvent[]>([]);
  const projectionFrameRef = useRef<number | null>(null);
  const fallbackRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const projectionRef = useRef<ClientProjection>({
    state: initialState(),
    detail: null
  });

  const busy = busyAction !== null;
  const nextTheme = theme === "dark" ? "light" : "dark";

  function beginRefresh() {
    refreshSeqRef.current += 1;
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
    setDetailSubscription(null);
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
    detailEventIdRef.current = nextDetail.latestEventId;
    setDetailSubscription({
      threadId,
      after: nextDetail.latestEventId
    });
    setDetail(nextDetail);
    return true;
  }

  function clearDetailForSelection(threadId: string) {
    if (projectionRef.current.detail?.id === threadId) {
      return;
    }
    setDetailSubscription(null);
    projectionRef.current = {
      state: projectionRef.current.state,
      detail: null
    };
    setDetail(null);
  }

  function clearDetail() {
    setDetailSubscription(null);
    projectionRef.current = {
      state: projectionRef.current.state,
      detail: null
    };
    setDetail(null);
  }

  async function loadThreadDetail(threadId: string, refreshSeq?: number) {
    clearDetailForSelection(threadId);
    const loadSeq = beginDetailLoad();
    const nextDetail = await getThread(threadId);
    if (refreshSeq !== undefined && !refreshIsCurrent(refreshSeq)) {
      return false;
    }
    return commitDetailLoad(threadId, nextDetail, loadSeq);
  }

  async function refresh(nextThreadId?: string | null, options: { loadDetail?: boolean } = {}) {
    const refreshSeq = beginRefresh();
    const requestedThreadId = nextThreadId ?? selectedThreadIdRef.current;
    const shouldPreferRequestedThread = typeof nextThreadId === "string";
    const next = await getState();
    if (!refreshIsCurrent(refreshSeq)) {
      return;
    }
    summaryEventIdRef.current = Math.max(summaryEventIdRef.current, next.latestEventId);
    setState(next);
    setSummaryEventsReady(true);
    projectionRef.current = {
      ...projectionRef.current,
      state: next
    };
    const preferredThreadId = choosePreferredThreadId(next.threads, {
      currentThreadId: selectedThreadIdRef.current,
      requestedThreadId,
      preferRequestedThread: shouldPreferRequestedThread,
      allowFallbackSelection: Boolean(requestedThreadId)
    });
    setSelectedThreadId(preferredThreadId);
    selectedThreadIdRef.current = preferredThreadId;
    if (preferredThreadId) {
      clearDetailForSelection(preferredThreadId);
      if (options.loadDetail) {
        try {
          await loadThreadDetail(preferredThreadId, refreshSeq);
        } catch (detailError) {
          if (refreshIsCurrent(refreshSeq) && selectedThreadIdRef.current === preferredThreadId) {
            throw detailError;
          }
        }
      }
    } else {
      beginDetailLoad();
      clearDetail();
    }
  }

  async function loadMoreThreads() {
    const current = projectionRef.current.state;
    if (!current.threadHasMore || loadingMoreThreadsRef.current) {
      return;
    }
    loadingMoreThreadsRef.current = true;
    setLoadingMoreThreads(true);
    setError(null);
    try {
      const page = await getThreadsPage({
        limit: current.threadPageSize,
        offset: current.threadNextOffset
      });
      setState((previous) => {
        const threads = mergeThreadsById(previous.threads, page.threads);
        const nextState: DashboardState = {
          ...previous,
          threads,
          threadTotalCount: page.totalCount,
          threadPageSize: page.limit,
          threadNextOffset: page.nextOffset,
          threadHasMore: page.hasMore
        };
        projectionRef.current = {
          ...projectionRef.current,
          state: nextState
        };
        return nextState;
      });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load more sessions");
    } finally {
      loadingMoreThreadsRef.current = false;
      setLoadingMoreThreads(false);
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
    if (isMobileViewportRef.current) {
      setMobileView("detail");
    }
    if (!shouldLoadDetail) {
      return;
    }
    setSelectedThreadId(threadId);
    selectedThreadIdRef.current = threadId;
    try {
      await loadThreadDetail(threadId);
    } catch (selectError) {
      if (selectedThreadIdRef.current === threadId) {
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
    isMobileViewportRef.current = isMobileViewport;
  }, [isMobileViewport]);

  useEffect(() => {
    if (!selectedThreadId && mobileView === "detail") {
      setMobileView("sessions");
    }
  }, [mobileView, selectedThreadId]);

  useEffect(() => {
    try {
      window.localStorage.setItem(terminalVisibleStorageKey, terminalVisible ? "true" : "false");
    } catch {
      // Keep the in-memory terminal visibility even if persistence is blocked.
    }
  }, [terminalVisible]);

  useEffect(() => {
    const handleTerminalShortcut = (event: globalThis.KeyboardEvent) => {
      if (!isMacTerminalToggleShortcut(event, window.navigator.platform)) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      setTerminalVisible((current) => !current);
    };

    window.addEventListener("keydown", handleTerminalShortcut, true);
    return () => {
      window.removeEventListener("keydown", handleTerminalShortcut, true);
    };
  }, []);

  function scheduleFallbackRefresh() {
    if (fallbackRefreshTimerRef.current) {
      return;
    }
    fallbackRefreshTimerRef.current = setTimeout(() => {
      fallbackRefreshTimerRef.current = null;
      void refresh();
    }, 250);
  }

  function flushProjectionEvents() {
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
  }

  function scheduleProjectionFlush() {
    if (projectionFrameRef.current !== null) {
      return;
    }
    projectionFrameRef.current = window.requestAnimationFrame(flushProjectionEvents);
  }

  function queueProjectionEvent(event: XyzEvent) {
    pendingEventsRef.current.push(event);
    scheduleProjectionFlush();
  }

  function parseSseEvent(rawEvent: Event) {
    const message = rawEvent as MessageEvent<string>;
    return JSON.parse(message.data) as XyzEvent;
  }

  useEffect(() => {
    return () => {
      if (fallbackRefreshTimerRef.current) {
        clearTimeout(fallbackRefreshTimerRef.current);
        fallbackRefreshTimerRef.current = null;
      }
      if (projectionFrameRef.current !== null) {
        window.cancelAnimationFrame(projectionFrameRef.current);
        projectionFrameRef.current = null;
      }
      pendingEventsRef.current = [];
    };
  }, []);

  useEffect(() => {
    if (!summaryEventsReady) {
      return;
    }

    let source: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;

    const handleEvent = (rawEvent: Event) => {
      try {
        const event = parseSseEvent(rawEvent);
        summaryEventIdRef.current = Math.max(summaryEventIdRef.current, event.id);
        queueProjectionEvent(event);
      } catch {
        scheduleFallbackRefresh();
      }
    };

    function connect() {
      const after = summaryEventIdRef.current;
      source = new EventSource(apiUrl(`/api/events?after=${after}`));
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
      source?.close();
    };
  }, [summaryEventsReady]);

  useEffect(() => {
    if (!detailSubscription) {
      return;
    }

    const threadId = detailSubscription.threadId;
    detailEventIdRef.current = detailSubscription.after;
    let source: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;

    const handleEvent = (rawEvent: Event) => {
      try {
        const event = parseSseEvent(rawEvent);
        detailEventIdRef.current = Math.max(detailEventIdRef.current, event.id);
        queueProjectionEvent(event);
      } catch {
        scheduleFallbackRefresh();
      }
    };

    function connect() {
      const after = detailEventIdRef.current;
      source = new EventSource(apiUrl(`/api/threads/${encodeURIComponent(threadId)}/events?after=${after}`));
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
      source?.close();
    };
  }, [detailSubscription]);

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
    () =>
      getSessionListModel(state.threads, state.tasks, deferredSessionQuery, {
        totalThreadCount: state.threadTotalCount,
        hasMoreThreads: state.threadHasMore
      }),
    [deferredSessionQuery, state.tasks, state.threadHasMore, state.threadTotalCount, state.threads]
  );
  const sessionCountLabel = sessionList.hasQuery
    ? sessionList.loadedThreadCount < sessionList.totalThreadCount
      ? `${sessionList.visibleThreadCount} / ${sessionList.loadedThreadCount} loaded shown, ${sessionList.totalThreadCount} total`
      : `${sessionList.visibleThreadCount} / ${sessionList.totalThreadCount} shown`
    : sessionList.loadedThreadCount < sessionList.totalThreadCount
      ? `${sessionList.loadedThreadCount} / ${sessionList.totalThreadCount} loaded`
      : `${sessionList.totalThreadCount} total`;
  const promptTarget = composerMode === "thread" && selectedThread ? "thread" : "new";
  const trimmedWorkdir = workdir.trim();
  const canUseGoalMode =
    promptTarget === "new"
      ? Boolean(trimmedWorkdir)
      : Boolean(selectedThreadId) && selectedThread?.status === "idle";
  const canUseQueueMode = promptTarget === "thread" && Boolean(selectedThreadId) && selectedThread?.status === "running";
  const canSubmitTurnPrompt = goalMode
    ? canUseGoalMode
    : promptTarget === "thread"
      ? Boolean(selectedThreadId)
      : Boolean(trimmedWorkdir);
  const canSubmitPrompt =
    Boolean(prompt.trim()) &&
    !busy &&
    (queueMode ? canUseQueueMode : canSubmitTurnPrompt);
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

  useEffect(() => {
    setQueueMode(false);
    setGoalMode(false);
  }, [selectedThreadId, promptTarget]);

  useEffect(() => {
    if (!canUseQueueMode) {
      setQueueMode(false);
    }
  }, [canUseQueueMode]);

  useEffect(() => {
    if (!canUseGoalMode) {
      setGoalMode(false);
    }
  }, [canUseGoalMode]);

  const updateWorkdir = useCallback((value: string) => {
    setWorkdir(value);
    setWorkdirTouched(true);
  }, []);

  const updateQueueMode = useCallback((value: boolean) => {
    setQueueMode(value);
    if (value) {
      setGoalMode(false);
    }
  }, []);

  const updateGoalMode = useCallback((value: boolean) => {
    setGoalMode(value);
    if (value) {
      setQueueMode(false);
    }
  }, []);

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
        await refresh(nextThreadId, { loadDetail: true });
      } else {
        await refresh();
      }
      if (options.successMessage) {
        setNotice(options.successMessage);
      }
      if (options.mobileViewOnSuccess && isMobileViewportRef.current) {
        setMobileView(options.mobileViewOnSuccess);
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

    if (queueMode) {
      if (!selectedThreadId || !canUseQueueMode) {
        return;
      }
      const threadId = selectedThreadId;
      setPrompt("");
      void runAction(
        "Queueing prompt",
        async () => {
          await queueTurn(threadId, currentPrompt);
        }
      );
      return;
    }

    if (goalMode && promptTarget === "thread") {
      if (!selectedThreadId || !canUseGoalMode) {
        return;
      }
      const threadId = selectedThreadId;
      setPrompt("");
      setComposerMode("thread");
      void runAction(
        "Starting goal mode",
        async () => {
          const result = await startGoal(threadId, currentPrompt.trim());
          return result.turn.threadId;
        },
        { mobileViewOnSuccess: "detail" }
      );
      return;
    }

    setPrompt("");

    if (promptTarget === "thread" && selectedThreadId) {
      const threadId = selectedThreadId;
      void runAction(
        "Starting turn",
        async () => {
          const turn = await startTurn(threadId, currentPrompt);
          return turn.threadId;
        },
        { mobileViewOnSuccess: "detail" }
      );
      return;
    }

    void runAction(
      goalMode ? "Creating goal session" : "Creating session",
      async () => {
        let project = matchingWorkdirProject;
        if (!project) {
          project = await createProject({ path: trimmedWorkdir });
        }
        setWorkdir(project.path);
        setWorkdirTouched(false);
        const result = await createTask({ projectId: project.id, prompt: currentPrompt, goalMode });
        const thread = result.thread;
        setComposerMode("thread");
        return thread?.id;
      },
      { selectResult: true, mobileViewOnSuccess: "detail" }
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

  function interruptSelectedThread() {
    if (!selectedThreadId) {
      return;
    }
    const threadId = selectedThreadId;
    void runAction("Interrupting turn", async () => {
      await interruptTurn(threadId);
    });
  }

  function resumeSelectedThread() {
    if (!selectedThreadId) {
      return;
    }
    const threadId = selectedThreadId;
    void runAction(
      "Resuming session",
      async () => {
        const thread = await resumeThread(threadId);
        return thread.id;
      },
      { successMessage: "Session resumed", mobileViewOnSuccess: "detail" }
    );
  }

  function forkSelectedThread() {
    if (!selectedThreadId) {
      return;
    }
    const threadId = selectedThreadId;
    void runAction(
      "Forking session",
      async () => {
        const thread = await forkThread(threadId);
        return thread.id;
      },
      { selectResult: true, mobileViewOnSuccess: "detail" }
    );
  }

  function setSelectedGoalStatus(status: "active" | "paused" | "complete", label: string) {
    if (!selectedThreadId) {
      return;
    }
    const threadId = selectedThreadId;
    void runAction(
      label,
      async () => {
        const result = await setGoalStatus(threadId, status);
        return result.thread?.id ?? threadId;
      },
      { mobileViewOnSuccess: "detail" }
    );
  }

  function pauseSelectedGoal() {
    setSelectedGoalStatus("paused", "Pausing goal");
  }

  function resumeSelectedGoal() {
    setSelectedGoalStatus("active", "Resuming goal");
  }

  function completeSelectedGoal() {
    setSelectedGoalStatus("complete", "Completing goal");
  }

  function clearSelectedGoal() {
    if (!selectedThreadId) {
      return;
    }
    const threadId = selectedThreadId;
    void runAction(
      "Clearing goal",
      async () => {
        const thread = await clearGoal(threadId);
        return thread?.id ?? threadId;
      },
      { mobileViewOnSuccess: "detail" }
    );
  }

  const desktopComposer = !isMobileViewport ? (
    <PromptComposer
      className="desktop-composer detail-composer"
      showStatus
      projects={state.projects}
      workdir={workdir}
      matchingProject={matchingWorkdirProject}
      busy={busy}
      busyAction={busyAction}
      notice={notice}
      error={error}
      prompt={prompt}
      promptTarget={promptTarget}
      goalMode={goalMode}
      selectedThreadId={selectedThreadId}
      queueMode={queueMode}
      canUseQueueMode={canUseQueueMode}
      canUseGoalMode={canUseGoalMode}
      canSubmitPrompt={canSubmitPrompt}
      onModeChange={setComposerMode}
      onWorkdirChange={updateWorkdir}
      onPromptChange={setPrompt}
      onPromptKeyDown={handlePromptKeyDown}
      onPromptSubmit={submitPrompt}
      onQueueModeChange={updateQueueMode}
      onGoalModeChange={updateGoalMode}
    />
  ) : null;

  return (
    <main
      className="app-shell"
      data-theme={theme}
      data-mobile-view={mobileView}
      data-terminal-visible={terminalVisible}
    >
      <div className="workspace" data-theme={theme} data-mobile-view={mobileView}>
        <SessionSidebar
          sessionCountLabel={sessionCountLabel}
          queuedTaskCount={sessionList.queuedTaskCount}
          busy={busy}
          theme={theme}
          nextTheme={nextTheme}
          terminalVisible={terminalVisible}
          sessionQuery={sessionQuery}
          sessionList={sessionList}
          selectedThreadId={selectedThreadId}
          loadingMoreThreads={loadingMoreThreads}
          onTerminalToggle={() => setTerminalVisible((current) => !current)}
          onThemeChange={setTheme}
          onRefresh={() => void refresh()}
          onLoadMoreThreads={() => void loadMoreThreads()}
          onSessionQueryChange={setSessionQuery}
          onSelectThread={selectThread}
        />

        <ThreadDetailView
          detail={selectedDetail}
          selectedThread={selectedThread}
          selectedThreadId={selectedThreadId}
          busy={busy}
          renameTitle={renameTitle}
          canRename={canRename}
          onBack={() => setMobileView("sessions")}
          onRenameTitleChange={setRenameTitle}
          onRenameSubmit={submitRename}
          onInterrupt={interruptSelectedThread}
          onResume={resumeSelectedThread}
          onFork={forkSelectedThread}
          onPauseGoal={pauseSelectedGoal}
          onResumeGoal={resumeSelectedGoal}
          onCompleteGoal={completeSelectedGoal}
          onClearGoal={clearSelectedGoal}
          composer={desktopComposer}
        />
      </div>
      <Suspense fallback={null}>
        {terminalVisible ? (
          <TerminalDock visible={terminalVisible} theme={theme} onClose={() => setTerminalVisible(false)} />
        ) : null}
      </Suspense>
      {isMobileViewport ? (
        <PromptComposer
          className="mobile-composer"
          showStatus
          compact
          projects={state.projects}
          workdir={workdir}
          matchingProject={matchingWorkdirProject}
          busy={busy}
          busyAction={busyAction}
          notice={notice}
          error={error}
          prompt={prompt}
          promptTarget={promptTarget}
          goalMode={goalMode}
          selectedThreadId={selectedThreadId}
          queueMode={queueMode}
          canUseQueueMode={canUseQueueMode}
          canUseGoalMode={canUseGoalMode}
          canSubmitPrompt={canSubmitPrompt}
          onModeChange={setComposerMode}
          onWorkdirChange={updateWorkdir}
          onPromptChange={setPrompt}
          onPromptKeyDown={handlePromptKeyDown}
          onPromptSubmit={submitPrompt}
          onQueueModeChange={updateQueueMode}
          onGoalModeChange={updateGoalMode}
        />
      ) : null}
      <MobileNavigation
        view={mobileView}
        hasSelection={Boolean(selectedThreadId)}
        onViewChange={setMobileView}
      />
    </main>
  );
}
