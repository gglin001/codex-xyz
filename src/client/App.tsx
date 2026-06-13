import type { FormEvent, KeyboardEvent } from "react";
import { lazy, Suspense, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
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

function isGoalPrompt(value: string) {
  return /^\/goal(?:\s|$)/i.test(value.trim());
}

export function App() {
  const [state, setState] = useState<DashboardState>(initialState);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ThreadDetail | null>(null);
  const [prompt, setPrompt] = useState("");
  const [steerMode, setSteerMode] = useState(false);
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
  const isMobileViewport = useMediaQuery(mobileViewportQuery);
  const isMobileViewportRef = useRef(isMobileViewport);
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
  const canUseSteerMode = promptTarget === "thread" && Boolean(selectedThreadId) && selectedThread?.status === "running";
  const canSubmitTurnPrompt = goalPrompt
    ? Boolean(selectedThreadId)
    : promptTarget === "thread"
      ? Boolean(selectedThreadId)
      : Boolean(trimmedWorkdir);
  const canSubmitPrompt =
    Boolean(prompt.trim()) &&
    !busy &&
    (steerMode ? canUseSteerMode : canSubmitTurnPrompt);
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
    setSteerMode(false);
  }, [selectedThreadId, promptTarget]);

  useEffect(() => {
    if (!canUseSteerMode) {
      setSteerMode(false);
    }
  }, [canUseSteerMode]);

  const updateWorkdir = useCallback((value: string) => {
    setWorkdir(value);
    setWorkdirTouched(true);
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

    if (steerMode) {
      if (!selectedThreadId || !canUseSteerMode) {
        return;
      }
      const threadId = selectedThreadId;
      setPrompt("");
      void runAction("Steering turn", async () => {
        await steerTurn(threadId, currentPrompt);
      });
      return;
    }

    if (isGoalPrompt(currentPrompt)) {
      if (!selectedThreadId) {
        setError("Select a session before using /goal.");
        return;
      }
      const threadId = selectedThreadId;
      setPrompt("");
      setComposerMode("thread");
      void runAction(
        "Starting goal turn",
        async () => {
          const turn = await startTurn(threadId, currentPrompt);
          return turn.threadId;
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
      goalPrompt={goalPrompt}
      selectedThread={selectedThread}
      selectedThreadId={selectedThreadId}
      steerMode={steerMode}
      canUseSteerMode={canUseSteerMode}
      canSubmitPrompt={canSubmitPrompt}
      onModeChange={setComposerMode}
      onWorkdirChange={updateWorkdir}
      onPromptChange={setPrompt}
      onPromptKeyDown={handlePromptKeyDown}
      onPromptSubmit={submitPrompt}
      onSteerModeChange={setSteerMode}
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
          onTerminalToggle={() => setTerminalVisible((current) => !current)}
          onThemeChange={setTheme}
          onRefresh={() => void refresh()}
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
          goalPrompt={goalPrompt}
          selectedThread={selectedThread}
          selectedThreadId={selectedThreadId}
          steerMode={steerMode}
          canUseSteerMode={canUseSteerMode}
          canSubmitPrompt={canSubmitPrompt}
          onModeChange={setComposerMode}
          onWorkdirChange={updateWorkdir}
          onPromptChange={setPrompt}
          onPromptKeyDown={handlePromptKeyDown}
          onPromptSubmit={submitPrompt}
          onSteerModeChange={setSteerMode}
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
