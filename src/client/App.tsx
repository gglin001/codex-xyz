 "use client";

import type { FormEvent, KeyboardEvent } from "react";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  apiUrl,
  createSession,
  getState,
  getThread,
  interruptTurn,
  resumeThread,
  startGoal,
  startTurn
} from "./api.js";
import { DashboardLayout } from "./components/DashboardLayout.js";
import { buildWorkbenchProjects, findProjectForThread, findSession } from "./components/workbenchData.js";
import type { ComposerMode, ParameterState, WorkbenchSession } from "./components/workbenchTypes.js";
import { applyEventProjectionBatch, incrementalEventNames, type ClientProjection } from "./eventProjection.js";
import { isMacTerminalToggleShortcut } from "./terminalShortcut.js";
import { choosePreferredThreadId, shouldLoadThreadSelection, shouldSelectActionResult } from "./threadSelection.js";
import { installPageZoomGuards } from "./zoomGuards.js"
import type { DashboardState, ThreadDetail, XyzEvent } from "../server/domain.js";

function initialState(): DashboardState {
  return {
    threads: [],
    threadTotalCount: 0,
    threadPageSize: 50,
    threadNextOffset: 0,
    threadHasMore: false,
    defaultCwd: "",
    latestEventId: 0
  };
}

type RunActionOptions = {
  selectResult?: boolean;
  successMessage?: string;
};

type DetailSubscription = {
  threadId: string;
  after: number;
};

const terminalVisibleStorageKey = "codex-xyz-terminal-visible";
const navigatorVisibleStorageKey = "codex-xyz-navigator-visible";
const inspectorVisibleStorageKey = "codex-xyz-inspector-visible";
const TerminalDock = lazy(async () => ({
  default: (await import("./TerminalDock.js")).TerminalDock
}));

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

function readStoredBoolean(key: string, fallback: boolean) {
  if (typeof window === "undefined") {
    return fallback;
  }
  try {
    const value = window.localStorage.getItem(key);
    return value === null ? fallback : value === "true";
  } catch {
    return fallback;
  }
}

export type AppProps = {
  initialState?: DashboardState;
};

export function App({ initialState: serverInitialState }: AppProps) {
  const [state, setState] = useState<DashboardState>(() => serverInitialState ?? initialState());
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ThreadDetail | null>(null);
  const [prompt, setPrompt] = useState("");
  const [goalMode, setGoalMode] = useState(false);
  const [workdir, setWorkdir] = useState("");
  const [workdirTouched, setWorkdirTouched] = useState(false);
  const [sessionQuery, setSessionQuery] = useState("");
  const [composerMode, setComposerMode] = useState<ComposerMode>("thread");
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [terminalVisible, setTerminalVisible] = useState(false);
  const [navigatorVisible, setNavigatorVisible] = useState(true);
  const [inspectorVisible, setInspectorVisible] = useState(true);
  const [selectedProjectId, setSelectedProjectId] = useState("project-alpha");
  const [params, setParams] = useState<ParameterState>({
    model: "codex",
    runtime: "Node",
    temperature: 0.28,
    maxTokens: 64000,
    reasoning: 62,
    autoRun: false
  });
  const [preferencesReady, setPreferencesReady] = useState(false);
  const [summaryEventsReady, setSummaryEventsReady] = useState(false);
  const [detailSubscription, setDetailSubscription] = useState<DetailSubscription | null>(null);
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
    state: serverInitialState ?? initialState(),
    detail: null
  });

  const busy = busyAction !== null;

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
      allowFallbackSelection: true
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
    if (serverInitialState) {
      summaryEventIdRef.current = Math.max(summaryEventIdRef.current, serverInitialState.latestEventId);
      setSummaryEventsReady(true);
      const preferredThreadId = choosePreferredThreadId(serverInitialState.threads, {
        currentThreadId: selectedThreadIdRef.current,
        requestedThreadId: null,
        preferRequestedThread: false,
        allowFallbackSelection: true
      });
      setSelectedThreadId(preferredThreadId);
      selectedThreadIdRef.current = preferredThreadId;
      if (preferredThreadId) {
        void loadThreadDetail(preferredThreadId).catch((loadError: unknown) => {
          if (selectedThreadIdRef.current === preferredThreadId) {
            setError(loadError instanceof Error ? loadError.message : "Failed to load session");
          }
        });
      }
      return;
    }
    void refresh(undefined, { loadDetail: true }).catch((loadError: unknown) => {
      setError(loadError instanceof Error ? loadError.message : "Failed to load state");
    });
  }, [serverInitialState]);

  useEffect(() => {
    document.documentElement.dataset.theme = "dark";
    setTerminalVisible(readStoredTerminalVisible());
    setNavigatorVisible(readStoredBoolean(navigatorVisibleStorageKey, true));
    setInspectorVisible(readStoredBoolean(inspectorVisibleStorageKey, true));
    setPreferencesReady(true);
  }, []);

  useEffect(() => {
    if (!preferencesReady) {
      return;
    }
    try {
      window.localStorage.setItem(terminalVisibleStorageKey, terminalVisible ? "true" : "false");
    } catch {
      // Keep the in-memory preference even if the browser blocks persistence.
    }
  }, [preferencesReady, terminalVisible]);

  useEffect(() => {
    if (!preferencesReady) {
      return;
    }
    try {
      window.localStorage.setItem(navigatorVisibleStorageKey, navigatorVisible ? "true" : "false");
    } catch {
      // Keep the in-memory preference even if the browser blocks persistence.
    }
  }, [navigatorVisible, preferencesReady]);

  useEffect(() => {
    if (!preferencesReady) {
      return;
    }
    try {
      window.localStorage.setItem(inspectorVisibleStorageKey, inspectorVisible ? "true" : "false");
    } catch {
      // Keep the in-memory preference even if the browser blocks persistence.
    }
  }, [inspectorVisible, preferencesReady]);

  useEffect(() => installPageZoomGuards(window), [])

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
  const workbenchProjects = useMemo(() => buildWorkbenchProjects(state.threads), [state.threads]);
  const selectedProject = workbenchProjects.find((project) => project.id === selectedProjectId) ?? workbenchProjects[0] ?? null;
  const selectedWorkbenchSession = useMemo(() => {
    const selectedByThread = findSession(workbenchProjects, selectedThreadId);
    if (selectedByThread) {
      return selectedByThread;
    }
    return selectedProject?.sessions[0] ?? null;
  }, [selectedProject, selectedThreadId, workbenchProjects]);
  const contextTokens = selectedDetail?.tokensUsed ?? selectedWorkbenchSession?.tokensUsed ?? 0;
  const contextLimit = params.maxTokens;
  const promptTarget = composerMode === "thread" && selectedThread ? "thread" : "new";
  const trimmedWorkdir = workdir.trim();
  const canUseGoalMode =
    promptTarget === "new"
      ? Boolean(trimmedWorkdir)
      : Boolean(selectedThreadId) && selectedThread?.status === "idle";
  const canSubmitTurnPrompt = goalMode
    ? canUseGoalMode
    : promptTarget === "thread"
      ? Boolean(selectedThreadId)
      : Boolean(trimmedWorkdir);
  const canSubmitPrompt = Boolean(prompt.trim()) && !busy && canSubmitTurnPrompt;
  useEffect(() => {
    if (!workdirTouched && workdir.length === 0 && state.defaultCwd) {
      setWorkdir(state.defaultCwd);
    }
  }, [state.defaultCwd, workdir, workdirTouched]);

  useEffect(() => {
    const project = findProjectForThread(workbenchProjects, selectedThreadId);
    if (project && project.id !== selectedProjectId) {
      setSelectedProjectId(project.id);
    }
  }, [selectedProjectId, selectedThreadId, workbenchProjects]);

  useEffect(() => {
    setGoalMode(false);
  }, [selectedThreadId, promptTarget]);

  useEffect(() => {
    if (!canUseGoalMode) {
      setGoalMode(false);
    }
  }, [canUseGoalMode]);

  const updateWorkdir = useCallback((value: string) => {
    setWorkdir(value);
    setWorkdirTouched(true);
  }, []);

  const updateGoalMode = useCallback((value: boolean) => {
    setGoalMode(value);
  }, []);

  const selectWorkbenchSession = useCallback(
    (session: WorkbenchSession) => {
      setComposerMode("thread");
      setError(null);
      setNotice(null);
      if (!session.threadId) {
        beginManualSelection();
        setSelectedThreadId(null);
        selectedThreadIdRef.current = null;
        beginDetailLoad();
        clearDetail();
        return;
      }
      void selectThread(session.threadId);
    },
    [selectThread]
  );

  const createWorkbenchSession = useCallback(() => {
    setComposerMode("new");
    setPrompt("");
    setGoalMode(false);
    if (!workdirTouched && selectedProject?.path) {
      setWorkdir(selectedProject.path);
    }
  }, [selectedProject?.path, workdirTouched]);

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
        }
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
        }
      );
      return;
    }

    void runAction(
      goalMode ? "Creating goal session" : "Creating session",
      async () => {
        const result = await createSession({ cwd: trimmedWorkdir, prompt: currentPrompt, goalMode });
        if (result.thread?.cwd) {
          setWorkdir(result.thread.cwd);
        }
        setWorkdirTouched(false);
        const thread = result.thread;
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
      { successMessage: "Session resumed" }
    );
  }

  return (
    <>
      <DashboardLayout
        projects={workbenchProjects}
        selectedProjectId={selectedProjectId}
        selectedSessionId={selectedWorkbenchSession?.id ?? selectedThreadId}
        session={selectedWorkbenchSession}
        detail={selectedDetail}
        selectedThread={selectedThread}
        selectedThreadId={selectedThreadId}
        navigatorVisible={navigatorVisible}
        inspectorVisible={inspectorVisible}
        terminalVisible={terminalVisible}
        sessionQuery={sessionQuery}
        params={params}
        contextTokens={contextTokens}
        contextLimit={contextLimit}
        workdir={workdir}
        busy={busy}
        busyAction={busyAction}
        notice={notice}
        error={error}
        prompt={prompt}
        promptTarget={promptTarget}
        goalMode={goalMode}
        canUseGoalMode={canUseGoalMode}
        canSubmitPrompt={canSubmitPrompt}
        onNavigatorVisibleChange={setNavigatorVisible}
        onInspectorVisibleChange={setInspectorVisible}
        onProjectChange={setSelectedProjectId}
        onSelectSession={selectWorkbenchSession}
        onCreateSession={createWorkbenchSession}
        onSessionQueryChange={setSessionQuery}
        onToggleTerminal={() => setTerminalVisible((current) => !current)}
        onParamChange={setParams}
        onPromptChange={setPrompt}
        onPromptKeyDown={handlePromptKeyDown}
        onPromptSubmit={submitPrompt}
        onModeChange={setComposerMode}
        onWorkdirChange={updateWorkdir}
        onGoalModeChange={updateGoalMode}
        onInterrupt={interruptSelectedThread}
        onResume={resumeSelectedThread}
      />
      <Suspense fallback={null}>
        {terminalVisible ? (
          <TerminalDock visible={terminalVisible} onClose={() => setTerminalVisible(false)} />
        ) : null}
      </Suspense>
    </>
  );
}
