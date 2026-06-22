"use client";

import type { FormEvent, KeyboardEvent } from "react";
import {
	lazy,
	Suspense,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import type {
	CozEvent,
	DashboardState,
	ThreadDetail,
} from "../server/domain.js";
import {
	createSession,
	forkThread,
	getState,
	getThread,
	interruptTurn,
	resumeThread,
	startGoal,
	startTurn,
} from "./api.js";
import { DashboardLayout } from "./components/DashboardLayout.js";
import {
	buildWorkbenchProjects,
	findProjectForThread,
} from "./components/workbenchData.js";
import type {
	ComposerMode,
	WorkbenchSession,
} from "./components/workbenchTypes.js";
import {
	clampDisplayScale,
	displayScale as displayScaleConfig,
} from "./designSystem.js";
import {
	applyEventProjectionBatch,
	type ClientProjection,
	incrementalEventNames,
} from "./eventProjection.js";
import {
	parseSseJsonEvent,
	useEventStreamSubscription,
} from "./eventStream.js";
import { isMacTerminalToggleShortcut } from "./terminalShortcut.js";
import {
	applyThemeMode,
	defaultThemeMode,
	readStoredThemeMode,
	type ThemeMode,
	writeStoredThemeMode,
} from "./theme.js";
import {
	choosePreferredThreadId,
	shouldLoadThreadSelection,
	shouldSelectActionResult,
} from "./threadSelection.js";

function initialState(): DashboardState {
	return {
		threads: [],
		threadTotalCount: 0,
		threadPageSize: 50,
		threadNextOffset: 0,
		threadHasMore: false,
		defaultCwd: "",
		latestEventId: 0,
	};
}

type RunActionOptions = {
	selectResult?: boolean;
	successMessage?: string;
};

type RefreshOptions = {
	loadDetail?: boolean;
	syncSelectedProject?: boolean;
};

type DetailSubscription = {
	threadId: string;
	after: number;
};

const terminalVisibleStorageKey = "coz-terminal-visible";
const navigatorVisibleStorageKey = "coz-navigator-visible";
const inspectorVisibleStorageKey = "coz-inspector-visible";
const wrapSessionContentStorageKey = "coz-wrap-session-content";
const displayScaleStorageKey = "coz-display-scale";
const TerminalDock = lazy(async () => ({
	default: (await import("./TerminalDock.js")).TerminalDock,
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

function readStoredDisplayScale() {
	if (typeof window === "undefined") {
		return displayScaleConfig.defaultValue;
	}
	try {
		const value = window.localStorage.getItem(displayScaleStorageKey);
		return value
			? clampDisplayScale(Number(value))
			: displayScaleConfig.defaultValue;
	} catch {
		return displayScaleConfig.defaultValue;
	}
}

export type AppProps = {
	initialState?: DashboardState;
};

export function App({ initialState: serverInitialState }: AppProps) {
	const [state, setState] = useState<DashboardState>(
		() => serverInitialState ?? initialState(),
	);
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
	const [wrapSessionContent, setWrapSessionContent] = useState(true);
	const [themeMode, setThemeMode] = useState<ThemeMode>(defaultThemeMode);
	const [selectedProjectId, setSelectedProjectId] = useState("");
	const [preferencesReady, setPreferencesReady] = useState(false);
	const [displayScale, setDisplayScale] = useState<number>(
		displayScaleConfig.defaultValue,
	);
	const [summaryEventsReady, setSummaryEventsReady] = useState(false);
	const [detailSubscription, setDetailSubscription] =
		useState<DetailSubscription | null>(null);
	const selectedThreadIdRef = useRef<string | null>(null);
	const manualSelectionSeqRef = useRef(0);
	const refreshSeqRef = useRef(0);
	const detailLoadSeqRef = useRef(0);
	const summaryEventIdRef = useRef(0);
	const detailEventIdRef = useRef(0);
	const pendingEventsRef = useRef<CozEvent[]>([]);
	const projectionFrameRef = useRef<number | null>(null);
	const goalModeResetKeyRef = useRef<string | null>(null);
	const fallbackRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
		null,
	);
	const projectionRef = useRef<ClientProjection>({
		state: serverInitialState ?? initialState(),
		detail: null,
	});

	const busy = busyAction !== null;

	const beginRefresh = useCallback(() => {
		refreshSeqRef.current += 1;
		return refreshSeqRef.current;
	}, []);

	const refreshIsCurrent = useCallback((refreshSeq: number) => {
		return refreshSeqRef.current === refreshSeq;
	}, []);

	const beginManualSelection = useCallback(() => {
		manualSelectionSeqRef.current += 1;
		refreshSeqRef.current += 1;
	}, []);

	const beginDetailLoad = useCallback(() => {
		detailLoadSeqRef.current += 1;
		setDetailSubscription(null);
		return detailLoadSeqRef.current;
	}, []);

	const detailLoadIsCurrent = useCallback(
		(threadId: string, loadSeq: number) => {
			return (
				detailLoadSeqRef.current === loadSeq &&
				selectedThreadIdRef.current === threadId
			);
		},
		[],
	);

	const commitDetailLoad = useCallback(
		(threadId: string, nextDetail: ThreadDetail, loadSeq: number) => {
			if (!detailLoadIsCurrent(threadId, loadSeq)) {
				return false;
			}
			projectionRef.current = {
				state: projectionRef.current.state,
				detail: nextDetail,
			};
			detailEventIdRef.current = nextDetail.latestEventId;
			setDetailSubscription({
				threadId,
				after: nextDetail.latestEventId,
			});
			setDetail(nextDetail);
			return true;
		},
		[detailLoadIsCurrent],
	);

	const clearDetailForSelection = useCallback((threadId: string) => {
		if (projectionRef.current.detail?.id === threadId) {
			return;
		}
		setDetailSubscription(null);
		projectionRef.current = {
			state: projectionRef.current.state,
			detail: null,
		};
		setDetail(null);
	}, []);

	const clearDetail = useCallback(() => {
		setDetailSubscription(null);
		projectionRef.current = {
			state: projectionRef.current.state,
			detail: null,
		};
		setDetail(null);
	}, []);

	const loadThreadDetail = useCallback(
		async (threadId: string, refreshSeq?: number) => {
			clearDetailForSelection(threadId);
			const loadSeq = beginDetailLoad();
			const nextDetail = await getThread(threadId);
			if (refreshSeq !== undefined && !refreshIsCurrent(refreshSeq)) {
				return false;
			}
			return commitDetailLoad(threadId, nextDetail, loadSeq);
		},
		[
			beginDetailLoad,
			clearDetailForSelection,
			commitDetailLoad,
			refreshIsCurrent,
		],
	);

	const refresh = useCallback(
		async (nextThreadId?: string | null, options: RefreshOptions = {}) => {
			const refreshSeq = beginRefresh();
			const requestedThreadId = nextThreadId ?? selectedThreadIdRef.current;
			const shouldPreferRequestedThread = typeof nextThreadId === "string";
			const next = await getState();
			if (!refreshIsCurrent(refreshSeq)) {
				return;
			}
			summaryEventIdRef.current = Math.max(
				summaryEventIdRef.current,
				next.latestEventId,
			);
			setState(next);
			setSummaryEventsReady(true);
			projectionRef.current = {
				...projectionRef.current,
				state: next,
			};
			const preferredThreadId = choosePreferredThreadId(next.threads, {
				currentThreadId: selectedThreadIdRef.current,
				requestedThreadId,
				preferRequestedThread: shouldPreferRequestedThread,
				allowFallbackSelection: true,
			});
			setSelectedThreadId(preferredThreadId);
			selectedThreadIdRef.current = preferredThreadId;
			if (options.syncSelectedProject && preferredThreadId) {
				const nextProject = findProjectForThread(
					buildWorkbenchProjects(next.threads, next.defaultCwd),
					preferredThreadId,
				);
				if (nextProject) {
					setSelectedProjectId(nextProject.id);
				}
			}
			if (preferredThreadId) {
				clearDetailForSelection(preferredThreadId);
				if (options.loadDetail) {
					try {
						await loadThreadDetail(preferredThreadId, refreshSeq);
					} catch (detailError) {
						if (
							refreshIsCurrent(refreshSeq) &&
							selectedThreadIdRef.current === preferredThreadId
						) {
							throw detailError;
						}
					}
				}
			} else {
				beginDetailLoad();
				clearDetail();
			}
		},
		[
			beginDetailLoad,
			beginRefresh,
			clearDetail,
			clearDetailForSelection,
			loadThreadDetail,
			refreshIsCurrent,
		],
	);

	const selectThread = useCallback(
		async (threadId: string) => {
			beginManualSelection();
			const shouldLoadDetail = shouldLoadThreadSelection(threadId, {
				currentThreadId: selectedThreadIdRef.current,
				currentDetailThreadId: projectionRef.current.detail?.id ?? null,
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
					setError(
						selectError instanceof Error
							? selectError.message
							: "Failed to load session",
					);
				}
			}
		},
		[beginManualSelection, loadThreadDetail],
	);

	useEffect(() => {
		if (serverInitialState) {
			summaryEventIdRef.current = Math.max(
				summaryEventIdRef.current,
				serverInitialState.latestEventId,
			);
			setSummaryEventsReady(true);
			const preferredThreadId = choosePreferredThreadId(
				serverInitialState.threads,
				{
					currentThreadId: selectedThreadIdRef.current,
					requestedThreadId: null,
					preferRequestedThread: false,
					allowFallbackSelection: true,
				},
			);
			setSelectedThreadId(preferredThreadId);
			selectedThreadIdRef.current = preferredThreadId;
			if (preferredThreadId) {
				void loadThreadDetail(preferredThreadId).catch((loadError: unknown) => {
					if (selectedThreadIdRef.current === preferredThreadId) {
						setError(
							loadError instanceof Error
								? loadError.message
								: "Failed to load session",
						);
					}
				});
			}
			return;
		}
		void refresh(undefined, { loadDetail: true }).catch(
			(loadError: unknown) => {
				setError(
					loadError instanceof Error
						? loadError.message
						: "Failed to load state",
				);
			},
		);
	}, [loadThreadDetail, refresh, serverInitialState]);

	useEffect(() => {
		const storedThemeMode = readStoredThemeMode();
		applyThemeMode(storedThemeMode);
		setThemeMode(storedThemeMode);
		setTerminalVisible(readStoredTerminalVisible());
		setNavigatorVisible(readStoredBoolean(navigatorVisibleStorageKey, true));
		setInspectorVisible(readStoredBoolean(inspectorVisibleStorageKey, true));
		setWrapSessionContent(
			readStoredBoolean(wrapSessionContentStorageKey, true),
		);
		setDisplayScale(readStoredDisplayScale());
		setPreferencesReady(true);
	}, []);

	useEffect(() => {
		if (!preferencesReady) {
			return;
		}
		applyThemeMode(themeMode);
		writeStoredThemeMode(themeMode);
	}, [preferencesReady, themeMode]);

	useEffect(() => {
		if (!preferencesReady) {
			return;
		}
		try {
			window.localStorage.setItem(
				terminalVisibleStorageKey,
				terminalVisible ? "true" : "false",
			);
		} catch {
			// Keep the in-memory preference even if the browser blocks persistence.
		}
	}, [preferencesReady, terminalVisible]);

	useEffect(() => {
		if (!preferencesReady) {
			return;
		}
		try {
			window.localStorage.setItem(
				navigatorVisibleStorageKey,
				navigatorVisible ? "true" : "false",
			);
		} catch {
			// Keep the in-memory preference even if the browser blocks persistence.
		}
	}, [navigatorVisible, preferencesReady]);

	useEffect(() => {
		if (!preferencesReady) {
			return;
		}
		try {
			window.localStorage.setItem(
				inspectorVisibleStorageKey,
				inspectorVisible ? "true" : "false",
			);
		} catch {
			// Keep the in-memory preference even if the browser blocks persistence.
		}
	}, [inspectorVisible, preferencesReady]);

	useEffect(() => {
		if (!preferencesReady) {
			return;
		}
		try {
			window.localStorage.setItem(
				wrapSessionContentStorageKey,
				wrapSessionContent ? "true" : "false",
			);
		} catch {
			// Keep the in-memory preference even if the browser blocks persistence.
		}
	}, [preferencesReady, wrapSessionContent]);

	useEffect(() => {
		if (!preferencesReady) {
			return;
		}
		try {
			window.localStorage.setItem(
				displayScaleStorageKey,
				displayScale.toString(),
			);
		} catch {
			// Keep the in-memory preference even if the browser blocks persistence.
		}
	}, [displayScale, preferencesReady]);

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
			detail: next.detail,
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
		projectionFrameRef.current = window.requestAnimationFrame(
			flushProjectionEvents,
		);
	}

	function queueProjectionEvent(event: CozEvent) {
		pendingEventsRef.current.push(event);
		scheduleProjectionFlush();
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

	useEventStreamSubscription({
		enabled: summaryEventsReady,
		subscriptionKey: summaryEventsReady ? "summary" : null,
		eventNames: incrementalEventNames,
		getPath: () => `/api/events?after=${summaryEventIdRef.current}`,
		onEvent: (rawEvent) => {
			try {
				const event = parseSseJsonEvent<CozEvent>(rawEvent);
				summaryEventIdRef.current = Math.max(
					summaryEventIdRef.current,
					event.id,
				);
				queueProjectionEvent(event);
			} catch {
				scheduleFallbackRefresh();
			}
		},
	});

	const detailSubscriptionKey = detailSubscription
		? `${detailSubscription.threadId}:${detailSubscription.after}`
		: null;

	useEffect(() => {
		if (detailSubscription) {
			detailEventIdRef.current = detailSubscription.after;
		}
	}, [detailSubscription]);

	useEventStreamSubscription({
		enabled: detailSubscription !== null,
		subscriptionKey: detailSubscriptionKey,
		eventNames: incrementalEventNames,
		getPath: () => {
			if (!detailSubscription) {
				return "/api/events?after=0";
			}
			return `/api/threads/${encodeURIComponent(detailSubscription.threadId)}/events?after=${detailEventIdRef.current}`;
		},
		onEvent: (rawEvent) => {
			try {
				const event = parseSseJsonEvent<CozEvent>(rawEvent);
				detailEventIdRef.current = Math.max(detailEventIdRef.current, event.id);
				queueProjectionEvent(event);
			} catch {
				scheduleFallbackRefresh();
			}
		},
	});

	const workbenchProjects = useMemo(
		() => buildWorkbenchProjects(state.threads, state.defaultCwd),
		[state.defaultCwd, state.threads],
	);
	const selectedProject =
		workbenchProjects.find((project) => project.id === selectedProjectId) ??
		workbenchProjects[0] ??
		null;
	const selectedWorkbenchSession = useMemo(() => {
		const selectedByThread =
			selectedProject?.sessions.find(
				(session) => session.threadId === selectedThreadId,
			) ?? null;
		if (selectedByThread) {
			return selectedByThread;
		}
		return selectedProject?.sessions[0] ?? null;
	}, [selectedProject, selectedThreadId]);
	const activeThreadId = selectedWorkbenchSession?.threadId ?? null;
	const activeThread = useMemo(
		() => state.threads.find((thread) => thread.id === activeThreadId) ?? null,
		[activeThreadId, state.threads],
	);
	const activeDetail = detail?.id === activeThreadId ? detail : null;
	const promptTarget =
		composerMode === "thread" && activeThread ? "thread" : "new";
	const trimmedWorkdir = workdir.trim();
	const canUseGoalMode =
		promptTarget === "new"
			? Boolean(trimmedWorkdir)
			: Boolean(activeThreadId) && activeThread?.status === "idle";
	const canSubmitTurnPrompt = goalMode
		? canUseGoalMode
		: promptTarget === "thread"
			? Boolean(activeThreadId)
			: Boolean(trimmedWorkdir);
	const canSubmitPrompt =
		Boolean(prompt.trim()) && !busy && canSubmitTurnPrompt;
	useEffect(() => {
		if (!workdirTouched && workdir.length === 0 && state.defaultCwd) {
			setWorkdir(state.defaultCwd);
		}
	}, [state.defaultCwd, workdir, workdirTouched]);

	useEffect(() => {
		if (
			!workbenchProjects.some((project) => project.id === selectedProjectId) &&
			workbenchProjects[0]
		) {
			setSelectedProjectId(workbenchProjects[0].id);
		}
	}, [selectedProjectId, workbenchProjects]);

	useEffect(() => {
		const projectThreadId = selectedWorkbenchSession?.threadId ?? null;
		if (projectThreadId === selectedThreadId) {
			return;
		}
		if (projectThreadId) {
			setComposerMode("thread");
			void selectThread(projectThreadId);
			return;
		}
		setComposerMode("new");
		setPrompt("");
		setGoalMode(false);
		if (selectedProject?.path) {
			setWorkdir(selectedProject.path);
			setWorkdirTouched(false);
		}
		beginManualSelection();
		setSelectedThreadId(null);
		selectedThreadIdRef.current = null;
		beginDetailLoad();
		clearDetail();
	}, [
		beginDetailLoad,
		beginManualSelection,
		clearDetail,
		selectThread,
		selectedProject,
		selectedThreadId,
		selectedWorkbenchSession,
	]);

	useEffect(() => {
		const resetKey = `${activeThreadId ?? ""}:${promptTarget}`;
		if (goalModeResetKeyRef.current === resetKey) {
			return;
		}
		goalModeResetKeyRef.current = resetKey;
		setGoalMode(false);
	});

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
		(
			session: WorkbenchSession,
			options: { clearSessionQuery?: boolean } = {},
		) => {
			const project = findProjectForThread(workbenchProjects, session.threadId);
			if (project) {
				setSelectedProjectId(project.id);
			}
			if (options.clearSessionQuery) {
				setSessionQuery("");
			}
			setComposerMode("thread");
			setError(null);
			setNotice(null);
			void selectThread(session.threadId);
		},
		[selectThread, workbenchProjects],
	);

	const changeWorkbenchProject = useCallback(
		(projectId: string) => {
			const project =
				workbenchProjects.find((candidate) => candidate.id === projectId) ??
				null;
			setSelectedProjectId(projectId);
			setSessionQuery("");
			setError(null);
			setNotice(null);
			const nextSession = project?.sessions[0] ?? null;
			if (nextSession) {
				setComposerMode("thread");
				void selectThread(nextSession.threadId);
				return;
			}
			setComposerMode("new");
			setPrompt("");
			setGoalMode(false);
			if (project?.path) {
				setWorkdir(project.path);
				setWorkdirTouched(false);
			}
			beginManualSelection();
			setSelectedThreadId(null);
			selectedThreadIdRef.current = null;
			beginDetailLoad();
			clearDetail();
		},
		[
			beginDetailLoad,
			beginManualSelection,
			clearDetail,
			selectThread,
			workbenchProjects,
		],
	);

	const enterNewSessionDraft = useCallback(
		(options: { clearPrompt?: boolean } = {}) => {
			setComposerMode("new");
			if (options.clearPrompt) {
				setPrompt("");
			}
			setGoalMode(false);
			if (selectedProject?.path) {
				setWorkdir(selectedProject.path);
				setWorkdirTouched(false);
			}
		},
		[selectedProject?.path],
	);

	const changeComposerMode = useCallback(
		(mode: ComposerMode) => {
			if (mode === "new") {
				enterNewSessionDraft();
				return;
			}
			setComposerMode(mode);
		},
		[enterNewSessionDraft],
	);

	const createWorkbenchSession = useCallback(() => {
		enterNewSessionDraft({ clearPrompt: true });
	}, [enterNewSessionDraft]);

	async function runAction(
		label: string,
		action: () => Promise<unknown>,
		options: RunActionOptions = {},
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
					currentSelectionSeq: manualSelectionSeqRef.current,
				})
			) {
				await refresh(nextThreadId, {
					loadDetail: true,
					syncSelectedProject: true,
				});
			} else {
				await refresh();
			}
			if (options.successMessage) {
				setNotice(options.successMessage);
			}
		} catch (actionError) {
			setError(
				actionError instanceof Error ? actionError.message : "Action failed",
			);
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
			if (!activeThreadId || !canUseGoalMode) {
				return;
			}
			const threadId = activeThreadId;
			setPrompt("");
			setComposerMode("thread");
			void runAction("Starting goal mode", async () => {
				const result = await startGoal(threadId, currentPrompt.trim());
				return result.turn.threadId;
			});
			return;
		}

		setPrompt("");

		if (promptTarget === "thread" && activeThreadId) {
			const threadId = activeThreadId;
			void runAction("Starting turn", async () => {
				const turn = await startTurn(threadId, currentPrompt);
				return turn.threadId;
			});
			return;
		}

		void runAction(
			goalMode ? "Creating goal session" : "Creating session",
			async () => {
				const result = await createSession({
					cwd: trimmedWorkdir,
					prompt: currentPrompt,
					goalMode,
					model: activeThread?.model ?? selectedWorkbenchSession?.model ?? null,
				});
				if (result.thread?.cwd) {
					setWorkdir(result.thread.cwd);
				}
				setWorkdirTouched(false);
				const thread = result.thread;
				setComposerMode("thread");
				return thread?.id;
			},
			{ selectResult: true },
		);
	}

	function submitPrompt(event: FormEvent) {
		event.preventDefault();
		executePrompt();
	}

	function handlePromptKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
		if (
			event.key === "Enter" &&
			event.metaKey &&
			!event.nativeEvent.isComposing
		) {
			event.preventDefault();
			executePrompt();
		}
	}

	function interruptSelectedThread() {
		if (!activeThreadId) {
			return;
		}
		const threadId = activeThreadId;
		void runAction("Interrupting turn", async () => {
			await interruptTurn(threadId);
		});
	}

	function resumeSelectedThread() {
		if (!activeThreadId) {
			return;
		}
		const threadId = activeThreadId;
		void runAction(
			"Resuming session",
			async () => {
				const thread = await resumeThread(threadId);
				return thread.id;
			},
			{ successMessage: "Session resumed" },
		);
	}

	function forkSelectedThread() {
		if (!activeThreadId) {
			return;
		}
		const threadId = activeThreadId;
		void runAction(
			"Forking thread",
			async () => {
				const thread = await forkThread(threadId);
				setComposerMode("thread");
				return thread.id;
			},
			{
				selectResult: true,
				successMessage: "Thread forked",
			},
		);
	}

	return (
		<>
			<DashboardLayout
				projects={workbenchProjects}
				selectedProjectId={selectedProjectId}
				selectedSessionId={selectedWorkbenchSession?.id ?? activeThreadId}
				session={selectedWorkbenchSession}
				detail={activeDetail}
				selectedThread={activeThread}
				selectedThreadId={activeThreadId}
				navigatorVisible={navigatorVisible}
				inspectorVisible={inspectorVisible}
				terminalVisible={terminalVisible}
				wrapSessionContent={wrapSessionContent}
				themeMode={themeMode}
				onThemeModeChange={setThemeMode}
				displayScale={displayScale}
				onDisplayScaleChange={(value) =>
					setDisplayScale(clampDisplayScale(value))
				}
				sessionQuery={sessionQuery}
				defaultCwd={state.defaultCwd}
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
				onWrapSessionContentChange={setWrapSessionContent}
				onProjectChange={changeWorkbenchProject}
				onSelectSession={selectWorkbenchSession}
				onCreateSession={createWorkbenchSession}
				onSessionQueryChange={setSessionQuery}
				onTerminalVisibleChange={setTerminalVisible}
				onPromptChange={setPrompt}
				onPromptKeyDown={handlePromptKeyDown}
				onPromptSubmit={submitPrompt}
				onModeChange={changeComposerMode}
				onWorkdirChange={updateWorkdir}
				onGoalModeChange={updateGoalMode}
				onInterrupt={interruptSelectedThread}
				onResume={resumeSelectedThread}
				onFork={forkSelectedThread}
			/>
			<Suspense fallback={null}>
				{terminalVisible ? (
					<TerminalDock
						themeMode={themeMode}
						visible={terminalVisible}
						onClose={() => setTerminalVisible(false)}
					/>
				) : null}
			</Suspense>
		</>
	);
}
