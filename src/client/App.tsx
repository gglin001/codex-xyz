 "use client";

import type { CSSProperties, FormEvent, KeyboardEvent } from "react";
import { lazy, Suspense, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { SidebarOpen } from "lucide-react";
import {
  apiUrl,
  createSession,
  getState,
  getThread,
  getThreadsPage,
  interruptTurn,
  resumeThread,
  startGoal,
  startTurn
} from "./api.js";
import { PromptComposer } from "./components/PromptComposer.js";
import { SessionSidebar } from "./components/SessionSidebar.js";
import { ThreadDetailView } from "./components/ThreadDetailView.js";
import type { ComposerMode, MobileView, ThemeMode } from "./components/types.js";
import { applyEventProjectionBatch, incrementalEventNames, type ClientProjection } from "./eventProjection.js";
import { getSessionListModel } from "./sessionList.js";
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
  mobileViewOnSuccess?: MobileView;
};

type DetailSubscription = {
  threadId: string;
  after: number;
};

type ViewportWidthProfile = "regular" | "narrow" | "tiny";
type ViewportHeightProfile = "regular" | "short" | "tiny";
type UiDensityProfile = "comfortable" | "compact" | "dense";
type ViewportStyle = CSSProperties & Record<`--${string}`, string | number>;

type ViewportProfile = {
  width: number;
  height: number;
  keyboardInset: number;
  widthProfile: ViewportWidthProfile;
  heightProfile: ViewportHeightProfile;
  density: UiDensityProfile;
  keyboardVisible: boolean;
  style: ViewportStyle;
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
const detailWordWrapStorageKey = "codex-xyz-detail-word-wrap";
const sidebarVisibleStorageKey = "codex-xyz-sidebar-visible";
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

function getViewportProfile(): ViewportProfile {
  if (typeof window === "undefined") {
    return defaultViewportProfile();
  }

  const root = document.documentElement;
  const visualViewport = window.visualViewport;
  const layoutWidth = Math.round(root.clientWidth || window.innerWidth || 1024);
  const layoutHeight = Math.round(window.innerHeight || root.clientHeight || 768);
  const width = Math.max(0, Math.round(visualViewport?.width ?? layoutWidth));
  const height = Math.max(0, Math.round(visualViewport?.height ?? layoutHeight));
  const viewportOffsetTop = Math.round(visualViewport?.offsetTop ?? 0);
  const keyboardInset = Math.max(0, layoutHeight - height - viewportOffsetTop);
  const widthProfile: ViewportWidthProfile = width <= 340 ? "tiny" : width <= 430 ? "narrow" : "regular";
  const heightProfile: ViewportHeightProfile = height <= 600 ? "tiny" : height <= 700 ? "short" : "regular";
  const keyboardVisible = keyboardInset > 80;
  const density: UiDensityProfile =
    widthProfile === "tiny" || heightProfile === "tiny"
      ? "dense"
      : widthProfile === "narrow" || heightProfile === "short" || keyboardVisible
        ? "compact"
        : "comfortable";
  const adaptiveFit = Math.max(0.86, Math.min(1, width / 390, height / 720));
  const composerRatio = keyboardVisible ? 0.4 : density === "dense" ? 0.42 : density === "compact" ? 0.48 : 0.54;
  const composerMaxHeight = Math.round(Math.max(168, Math.min(440, height * composerRatio)));
  const textareaMaxHeight = Math.round(Math.max(96, Math.min(240, height * (keyboardVisible ? 0.22 : 0.34))));
  const composerReserved = keyboardVisible
    ? Math.round(Math.max(52, Math.min(176, composerMaxHeight)))
    : density === "dense"
      ? 48
      : density === "compact"
        ? 54
        : 58;
  const panelPadding = density === "dense" ? 10 : density === "compact" ? 12 : 14;
  const edgePadding = density === "dense" ? 8 : 10;
  const mobileGap = density === "dense" ? 7 : density === "compact" ? 8 : 10;
  const mobileHeaderControlSize = density === "dense" ? 30 : density === "compact" ? 32 : 34;
  const mobileControlSize = density === "dense" ? 38 : 40;

  return {
    width,
    height,
    keyboardInset,
    widthProfile,
    heightProfile,
    density,
    keyboardVisible,
    style: {
      "--app-viewport-width": `${width}px`,
      "--app-viewport-height": `${height}px`,
      "--keyboard-inset": `${keyboardInset}px`,
      "--adaptive-fit": adaptiveFit.toFixed(3),
      "--mobile-composer-max-height": `${composerMaxHeight}px`,
      "--mobile-textarea-max-height": `${textareaMaxHeight}px`,
      "--mobile-composer-reserved": `${composerReserved}px`,
      "--mobile-panel-padding": `${panelPadding}px`,
      "--mobile-edge-padding": `${edgePadding}px`,
      "--mobile-gap": `${mobileGap}px`,
      "--mobile-header-control-size": `${mobileHeaderControlSize}px`,
      "--mobile-control-size": `${mobileControlSize}px`
    }
  };
}

function defaultViewportProfile(): ViewportProfile {
  return {
    width: 1024,
    height: 768,
    keyboardInset: 0,
    widthProfile: "regular",
    heightProfile: "regular",
    density: "comfortable",
    keyboardVisible: false,
    style: {
      "--app-viewport-width": "1024px",
      "--app-viewport-height": "768px",
      "--keyboard-inset": "0px",
      "--adaptive-fit": "1",
      "--mobile-composer-max-height": "414px",
      "--mobile-textarea-max-height": "240px",
      "--mobile-composer-reserved": "58px",
      "--mobile-panel-padding": "14px",
      "--mobile-edge-padding": "10px",
      "--mobile-gap": "10px",
      "--mobile-header-control-size": "34px",
      "--mobile-control-size": "40px"
    }
  };
}

function sameViewportProfile(current: ViewportProfile, next: ViewportProfile) {
  return (
    current.width === next.width &&
    current.height === next.height &&
    current.keyboardInset === next.keyboardInset &&
    current.widthProfile === next.widthProfile &&
    current.heightProfile === next.heightProfile &&
    current.density === next.density &&
    current.keyboardVisible === next.keyboardVisible
  );
}

function useViewportProfile() {
  const [profile, setProfile] = useState(defaultViewportProfile);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    let animationFrame: number | null = null;
    const syncProfile = () => {
      if (animationFrame !== null) {
        return;
      }
      animationFrame = window.requestAnimationFrame(() => {
        animationFrame = null;
        setProfile((current) => {
          const next = getViewportProfile();
          return sameViewportProfile(current, next) ? current : next;
        });
      });
    };

    syncProfile();
    window.addEventListener("resize", syncProfile);
    window.addEventListener("orientationchange", syncProfile);
    window.visualViewport?.addEventListener("resize", syncProfile);
    window.visualViewport?.addEventListener("scroll", syncProfile);
    return () => {
      if (animationFrame !== null) {
        window.cancelAnimationFrame(animationFrame);
      }
      window.removeEventListener("resize", syncProfile);
      window.removeEventListener("orientationchange", syncProfile);
      window.visualViewport?.removeEventListener("resize", syncProfile);
      window.visualViewport?.removeEventListener("scroll", syncProfile);
    };
  }, []);

  return profile;
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

function readStoredDetailWordWrap() {
  if (typeof window === "undefined") {
    return true;
  }
  try {
    return window.localStorage.getItem(detailWordWrapStorageKey) !== "false";
  } catch {
    return true;
  }
}

function readStoredSidebarVisible() {
  if (typeof window === "undefined") {
    return true;
  }
  try {
    return window.localStorage.getItem(sidebarVisibleStorageKey) !== "false";
  } catch {
    return true;
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
  const [theme, setTheme] = useState<ThemeMode>(readStoredTheme);
  const [detailWordWrap, setDetailWordWrap] = useState(readStoredDetailWordWrap);
  const [terminalVisible, setTerminalVisible] = useState(readStoredTerminalVisible);
  const [sidebarVisible, setSidebarVisible] = useState(readStoredSidebarVisible);
  const [mobileView, setMobileView] = useState<MobileView>("sessions");
  const [summaryEventsReady, setSummaryEventsReady] = useState(false);
  const [detailSubscription, setDetailSubscription] = useState<DetailSubscription | null>(null);
  const [loadingMoreThreads, setLoadingMoreThreads] = useState(false);
  const isMobileViewport = useMediaQuery(mobileViewportQuery);
  const viewportProfile = useViewportProfile();
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
    state: serverInitialState ?? initialState(),
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

  async function refreshSessions() {
    setBusyAction("Refreshing sessions");
    setError(null);
    setNotice(null);
    try {
      await refresh(undefined, { loadDetail: Boolean(selectedThreadIdRef.current) });
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : "Failed to refresh sessions");
    } finally {
      setBusyAction(null);
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
    document.documentElement.dataset.theme = theme;
    try {
      window.localStorage.setItem(themeStorageKey, theme);
    } catch {
      // Keep the in-memory theme even if the browser blocks persistence.
    }
  }, [theme]);

  useEffect(() => {
    try {
      window.localStorage.setItem(detailWordWrapStorageKey, detailWordWrap ? "true" : "false");
    } catch {
      // Keep the in-memory detail wrapping preference even if persistence is blocked.
    }
  }, [detailWordWrap]);

  useEffect(() => {
    try {
      window.localStorage.setItem(sidebarVisibleStorageKey, sidebarVisible ? "true" : "false");
    } catch {
      // Keep the in-memory sidebar preference even if persistence is blocked.
    }
  }, [sidebarVisible]);

  useEffect(() => {
    isMobileViewportRef.current = isMobileViewport;
  }, [isMobileViewport]);

  useEffect(() => installPageZoomGuards(window), [])

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
  const sessionList = useMemo(
    () =>
      getSessionListModel(state.threads, deferredSessionQuery, {
        totalThreadCount: state.threadTotalCount,
        hasMoreThreads: state.threadHasMore
      }),
    [deferredSessionQuery, state.threadHasMore, state.threadTotalCount, state.threads]
  );
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
        const result = await createSession({ cwd: trimmedWorkdir, prompt: currentPrompt, goalMode });
        if (result.thread?.cwd) {
          setWorkdir(result.thread.cwd);
        }
        setWorkdirTouched(false);
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

  const desktopComposer = !isMobileViewport ? (
    <PromptComposer
      className="desktop-composer detail-composer"
      showStatus
      workdir={workdir}
      busy={busy}
      busyAction={busyAction}
      notice={notice}
      error={error}
      prompt={prompt}
      promptTarget={promptTarget}
      goalMode={goalMode}
      selectedThread={selectedThread}
      selectedThreadId={selectedThreadId}
      canUseGoalMode={canUseGoalMode}
      canSubmitPrompt={canSubmitPrompt}
      onModeChange={setComposerMode}
      onWorkdirChange={updateWorkdir}
      onPromptChange={setPrompt}
      onPromptKeyDown={handlePromptKeyDown}
      onPromptSubmit={submitPrompt}
      onGoalModeChange={updateGoalMode}
      onInterrupt={interruptSelectedThread}
      onResume={resumeSelectedThread}
    />
  ) : null;

  return (
    <main
      className="app-shell"
      data-theme={theme}
      data-mobile-view={mobileView}
      data-terminal-visible={terminalVisible}
      data-viewport-width={viewportProfile.widthProfile}
      data-viewport-height={viewportProfile.heightProfile}
      data-ui-density={viewportProfile.density}
      data-keyboard-visible={viewportProfile.keyboardVisible}
      data-sidebar-visible={sidebarVisible}
      style={viewportProfile.style}
    >
      <div className="workspace" data-theme={theme} data-mobile-view={mobileView} data-sidebar-visible={sidebarVisible}>
        {sidebarVisible || isMobileViewport ? (
          <SessionSidebar
            density={isMobileViewport ? "compact" : "regular"}
            busy={busy}
            theme={theme}
            nextTheme={nextTheme}
            detailWordWrap={detailWordWrap}
            terminalVisible={terminalVisible}
            sessionQuery={sessionQuery}
            sessionList={sessionList}
            selectedThreadId={selectedThreadId}
            loadingMoreThreads={loadingMoreThreads}
            onSidebarToggle={isMobileViewport ? undefined : () => setSidebarVisible(false)}
            onTerminalToggle={() => setTerminalVisible((current) => !current)}
            onThemeChange={setTheme}
            onDetailWordWrapChange={setDetailWordWrap}
            onRefresh={() => void refreshSessions()}
            onLoadMoreThreads={() => void loadMoreThreads()}
            onSessionQueryChange={setSessionQuery}
            onSelectThread={selectThread}
          />
        ) : (
          <button
            type="button"
            className="sidebar-restore-button"
            title="Show sidebar"
            aria-label="Show sidebar"
            onClick={() => setSidebarVisible(true)}
          >
            <SidebarOpen size={18} />
          </button>
        )}

        <ThreadDetailView
          detail={selectedDetail}
          selectedThread={selectedThread}
          selectedThreadId={selectedThreadId}
          detailWordWrap={detailWordWrap}
          onBack={() => setMobileView("sessions")}
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
          collapsible
          workdir={workdir}
          busy={busy}
          busyAction={busyAction}
          notice={notice}
          error={error}
          prompt={prompt}
          promptTarget={promptTarget}
          goalMode={goalMode}
          selectedThread={selectedThread}
          selectedThreadId={selectedThreadId}
          canUseGoalMode={canUseGoalMode}
          canSubmitPrompt={canSubmitPrompt}
          onModeChange={setComposerMode}
          onWorkdirChange={updateWorkdir}
          onPromptChange={setPrompt}
          onPromptKeyDown={handlePromptKeyDown}
          onPromptSubmit={submitPrompt}
          onGoalModeChange={updateGoalMode}
          onInterrupt={interruptSelectedThread}
          onResume={resumeSelectedThread}
        />
      ) : null}
    </main>
  );
}
