"use client";

import { MotionConfig } from "framer-motion";
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
	ControlThread,
	CozEvent,
	DashboardState,
	ThreadDetail,
	ThreadItem,
	ThreadItemsPage,
	ThreadTagScore,
	Turn,
} from "../server/domain.js";
import {
	archiveThread,
	cleanBackgroundTerminals,
	compactThread,
	createThread,
	forkThread,
	getState,
	getThread,
	getThreadItemsPage,
	getThreadsPage,
	interruptTurn,
	listBackgroundTerminals,
	restartCodexAppServer,
	resumeThread,
	searchThreadHistory,
	setThreadTagScore,
	startGoal,
	startTurn,
	syncThreadHistory,
	unarchiveThread,
} from "./api.js";
import { DashboardLayout } from "./components/DashboardLayout.js";
import {
	buildWorkbenchProjects,
	findProjectForThread,
} from "./components/workbenchData.js";
import type {
	ComposerMode,
	SubmittedPromptFocusTarget,
	WorkbenchThread,
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
import {
	applyOptimisticTurnDraft,
	createOptimisticThreadDraft,
	createOptimisticThreadId,
	createOptimisticTurnDraft,
	failOptimisticThreadState,
	failOptimisticTurnDraft,
	insertOptimisticThreadState,
	isOptimisticThreadId,
	isOptimisticTurnId,
	rebaseOptimisticThreadDetail,
	removeOptimisticThreadState,
	replaceOptimisticThreadState,
	resolveOptimisticTurnDraft,
	shouldResolveOptimisticThread,
} from "./optimisticThreads.js";
import { isMacTerminalToggleShortcut } from "./terminalShortcut.js";
import {
	applyThemeMode,
	defaultThemeMode,
	readStoredThemeMode,
	type ThemeMode,
	writeStoredThemeMode,
} from "./theme.js";
import {
	isThreadActive,
	isThreadArchived,
	isThreadRuntimeActionable,
} from "./threadLifecycle.js";
import {
	choosePreferredThreadId,
	queryMatchesArchivedThreads,
	shouldLoadThreadSelection,
	shouldSelectActionResult,
} from "./threadSelection.js";
import { useDateTimeFormatMode } from "./useDateTimeFormatMode.js";

const transientAlertAutoDismissMs = 10_000;
const archivedSearchPageSize = 200;
const transcriptHistoryPageSize = 200;
const mobileProjectionFlushMs = 100;
const streamEventNames = [...incrementalEventNames, "events.reset"] as const;

function initialState(): DashboardState {
	return {
		threads: [],
		threadTotalCount: 0,
		threadPageSize: 50,
		threadNextCursor: null,
		threadHasMore: false,
		defaultCwd: "",
		defaultModel: null,
		latestEventId: 0,
	};
}

function compareThreadItems(a: ThreadItem, b: ThreadItem) {
	if (a.createdAt === b.createdAt) {
		return a.id.localeCompare(b.id);
	}
	return a.createdAt < b.createdAt ? -1 : 1;
}

function mergeThreadItems(detail: ThreadDetail, page: ThreadItemsPage) {
	const byId = new Map<string, ThreadItem>();
	for (const item of page.items) {
		byId.set(item.id, item);
	}
	for (const item of detail.items) {
		byId.set(item.id, item);
	}
	const items = [...byId.values()].sort(compareThreadItems);
	return {
		...detail,
		items,
		itemTotalCount: page.totalCount,
		itemPageSize: items.length,
		itemPageDirection: page.direction,
		itemNextCursor: page.nextCursor,
		itemHasMore: page.hasMore,
	};
}

function initialSelection(state: DashboardState) {
	const selectedThreadId = choosePreferredThreadId(state.threads, {
		currentThreadId: null,
		requestedThreadId: null,
		preferRequestedThread: false,
		allowFallbackSelection: true,
	});
	const projects = buildWorkbenchProjects(state.threads, state.defaultCwd);
	const selectedProject =
		findProjectForThread(projects, selectedThreadId) ?? projects[0] ?? null;

	return {
		selectedProjectId: selectedProject?.id ?? "",
		selectedThreadId,
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

type OptimisticThreadSubmission = {
	id: string;
	cwd: string;
	name: string;
	createdAt: string;
	resolvedThreadId: string | null;
};

type OptimisticTurnSubmission = {
	turnId: string;
	threadId: string;
	previousThread: ControlThread;
	draft: ReturnType<typeof createOptimisticTurnDraft>;
};

type ResetEvent = {
	type: "events.reset";
	reason: string;
	after: number;
	latestEventId: number;
	threadId?: string | null;
};

function isMobileViewport() {
	return (
		typeof window !== "undefined" &&
		typeof window.matchMedia === "function" &&
		window.matchMedia("(max-width: 767px)").matches
	);
}

function backgroundTerminalSummary(
	terminals: Awaited<ReturnType<typeof listBackgroundTerminals>>["terminals"],
) {
	if (terminals.length === 0) {
		return "No background terminals";
	}
	const preview = terminals
		.slice(0, 3)
		.map((terminal) => {
			const command = terminal.command.trim() || terminal.processId;
			const cwd = terminal.cwd ? ` (${terminal.cwd})` : "";
			return `${command}${cwd}`;
		})
		.join("; ");
	const suffix = terminals.length > 3 ? `; +${terminals.length - 3} more` : "";
	return `${terminals.length} background terminal${
		terminals.length === 1 ? "" : "s"
	}: ${preview}${suffix}`;
}

function eventThreadPayload(event: CozEvent) {
	const thread = event.payload.thread;
	return thread !== null &&
		typeof thread === "object" &&
		"id" in thread &&
		typeof thread.id === "string" &&
		"cwd" in thread &&
		typeof thread.cwd === "string" &&
		"name" in thread &&
		typeof thread.name === "string"
		? (thread as ControlThread)
		: null;
}

function eventTurnPayload(event: CozEvent) {
	const turn = event.payload.turn;
	return turn !== null &&
		typeof turn === "object" &&
		"id" in turn &&
		typeof turn.id === "string" &&
		"threadId" in turn &&
		typeof turn.threadId === "string"
		? (turn as Turn)
		: null;
}

const terminalVisibleStorageKey = "coz-terminal-visible";
const navigatorVisibleStorageKey = "coz-navigator-visible";
const inspectorVisibleStorageKey = "coz-inspector-visible";
// Keep the existing key so current users retain their transcript wrap preference.
const wrapThreadContentStorageKey = "coz-wrap-session-content";
const displayScaleStorageKey = "coz-display-scale";
const promptDraftStorageKey = "coz-prompt-draft";
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

function readStoredPromptDraft() {
	if (typeof window === "undefined") {
		return "";
	}
	try {
		return window.localStorage.getItem(promptDraftStorageKey) ?? "";
	} catch {
		return "";
	}
}

function writeStoredPromptDraft(value: string) {
	if (typeof window === "undefined") {
		return;
	}
	try {
		if (value.length > 0) {
			window.localStorage.setItem(promptDraftStorageKey, value);
		} else {
			window.localStorage.removeItem(promptDraftStorageKey);
		}
	} catch {
		// Keep the in-memory draft even if the browser blocks persistence.
	}
}

export type AppProps = {
	initialState?: DashboardState;
};

export function App({ initialState: serverInitialState }: AppProps) {
	const appInitialState = serverInitialState ?? initialState();
	const appInitialSelection = initialSelection(appInitialState);
	const dateTimeFormatMode = useDateTimeFormatMode();
	const [state, setState] = useState<DashboardState>(() => appInitialState);
	const [selectedThreadId, setSelectedThreadId] = useState<string | null>(
		() => appInitialSelection.selectedThreadId,
	);
	const [detail, setDetail] = useState<ThreadDetail | null>(null);
	const [prompt, setPrompt] = useState("");
	const [goalMode, setGoalMode] = useState(false);
	const [workdir, setWorkdir] = useState("");
	const [workdirTouched, setWorkdirTouched] = useState(false);
	const [threadQuery, setThreadQuery] = useState("");
	const [archivedThreads, setArchivedThreads] = useState<ControlThread[]>([]);
	const [archivedRefreshKey, setArchivedRefreshKey] = useState(0);
	const [historySearchThreads, setHistorySearchThreads] = useState<
		ControlThread[]
	>([]);
	const [refreshingHistory, setRefreshingHistory] = useState(false);
	const [composerMode, setComposerMode] = useState<ComposerMode>("thread");
	const [submittedPromptFocusTarget, setSubmittedPromptFocusTarget] =
		useState<SubmittedPromptFocusTarget | null>(null);
	const [busyAction, setBusyAction] = useState<string | null>(null);
	const busyActionRef = useRef<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [notice, setNotice] = useState<string | null>(null);
	const [terminalVisible, setTerminalVisible] = useState(false);
	const [navigatorVisible, setNavigatorVisible] = useState(true);
	const [inspectorVisible, setInspectorVisible] = useState(true);
	const [wrapThreadContent, setWrapThreadContent] = useState(true);
	const [themeMode, setThemeMode] = useState<ThemeMode>(defaultThemeMode);
	const [selectedProjectId, setSelectedProjectId] = useState(
		() => appInitialSelection.selectedProjectId,
	);
	const [preferencesReady, setPreferencesReady] = useState(false);
	const [displayScale, setDisplayScale] = useState<number>(
		displayScaleConfig.defaultValue,
	);
	const [summaryEventsReady, setSummaryEventsReady] = useState(false);
	const [detailSubscription, setDetailSubscription] =
		useState<DetailSubscription | null>(null);
	const [loadingEarlierTranscript, setLoadingEarlierTranscript] =
		useState(false);
	const selectedThreadIdRef = useRef<string | null>(
		appInitialSelection.selectedThreadId,
	);
	const manualSelectionSeqRef = useRef(0);
	const refreshSeqRef = useRef(0);
	const archivedSearchSeqRef = useRef(0);
	const historySearchSeqRef = useRef(0);
	const detailLoadSeqRef = useRef(0);
	const summaryEventIdRef = useRef(0);
	const detailEventIdRef = useRef(0);
	const pendingEventsRef = useRef<CozEvent[]>([]);
	const projectionFrameRef = useRef<number | null>(null);
	const projectionFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
		null,
	);
	const goalModeResetKeyRef = useRef<string | null>(null);
	const fallbackRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
		null,
	);
	const optimisticThreadRef = useRef<OptimisticThreadSubmission | null>(null);
	const optimisticTurnsRef = useRef<OptimisticTurnSubmission[]>([]);
	const submittedPromptFocusSequenceRef = useRef(0);
	const projectionRef = useRef<ClientProjection>({
		state: appInitialState,
		detail: null,
	});

	const busy = busyAction !== null;

	const commitProjection = useCallback((next: ClientProjection) => {
		const previous = projectionRef.current;
		projectionRef.current = next;
		if (next.state !== previous.state) {
			setState(next.state);
		}
		if (next.detail !== previous.detail) {
			setDetail(next.detail);
		}
	}, []);

	const requestSubmittedPromptFocus = useCallback((itemId: string) => {
		submittedPromptFocusSequenceRef.current += 1;
		setSubmittedPromptFocusTarget({
			itemId,
			sequence: submittedPromptFocusSequenceRef.current,
		});
	}, []);

	const beginRefresh = useCallback(() => {
		refreshSeqRef.current += 1;
		return refreshSeqRef.current;
	}, []);

	const keepPendingOptimisticThread = useCallback((next: DashboardState) => {
		const pending = optimisticThreadRef.current;
		if (!pending || next.threads.some((thread) => thread.id === pending.id)) {
			return next;
		}
		const pendingThread = projectionRef.current.state.threads.find(
			(thread) => thread.id === pending.id,
		);
		return pendingThread
			? insertOptimisticThreadState(next, pendingThread)
			: next;
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

	const loadEarlierTranscriptItems = useCallback(async () => {
		const currentDetail = projectionRef.current.detail;
		if (
			!currentDetail ||
			selectedThreadIdRef.current !== currentDetail.id ||
			currentDetail.itemPageDirection !== "before" ||
			!currentDetail.itemHasMore ||
			!currentDetail.itemNextCursor
		) {
			return false;
		}
		setLoadingEarlierTranscript(true);
		try {
			const page = await getThreadItemsPage({
				threadId: currentDetail.id,
				limit: transcriptHistoryPageSize,
				beforeCursor: currentDetail.itemNextCursor,
			});
			setDetail((latestDetail) => {
				if (
					!latestDetail ||
					latestDetail.id !== currentDetail.id ||
					selectedThreadIdRef.current !== currentDetail.id
				) {
					return latestDetail;
				}
				const nextDetail = mergeThreadItems(latestDetail, page);
				projectionRef.current = {
					state: projectionRef.current.state,
					detail: nextDetail,
				};
				return nextDetail;
			});
			setError(null);
			return true;
		} catch (loadError) {
			setError(
				loadError instanceof Error
					? loadError.message
					: "Failed to load earlier transcript items",
			);
			return false;
		} finally {
			setLoadingEarlierTranscript(false);
		}
	}, []);

	const refresh = useCallback(
		async (nextThreadId?: string | null, options: RefreshOptions = {}) => {
			const refreshSeq = beginRefresh();
			const requestedThreadId = nextThreadId ?? selectedThreadIdRef.current;
			const shouldPreferRequestedThread = typeof nextThreadId === "string";
			let next = await getState();
			if (!refreshIsCurrent(refreshSeq)) {
				return;
			}
			next = keepPendingOptimisticThread(next);
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
				const preferredIsPendingOptimistic =
					preferredThreadId === optimisticThreadRef.current?.id;
				clearDetailForSelection(preferredThreadId);
				if (options.loadDetail && !preferredIsPendingOptimistic) {
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
			keepPendingOptimisticThread,
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
							: "Failed to load thread",
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
								: "Failed to load thread",
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
		setWrapThreadContent(readStoredBoolean(wrapThreadContentStorageKey, true));
		setDisplayScale(readStoredDisplayScale());
		setPreferencesReady(true);
	}, []);

	useEffect(() => {
		setPrompt(readStoredPromptDraft());
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
				wrapThreadContentStorageKey,
				wrapThreadContent ? "true" : "false",
			);
		} catch {
			// Keep the in-memory preference even if the browser blocks persistence.
		}
	}, [preferencesReady, wrapThreadContent]);

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
			void refresh(undefined, { loadDetail: true });
		}, 250);
	}

	function flushProjectionEvents() {
		projectionFrameRef.current = null;
		if (projectionFlushTimerRef.current) {
			clearTimeout(projectionFlushTimerRef.current);
			projectionFlushTimerRef.current = null;
		}
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
		if (isMobileViewport()) {
			if (
				projectionFlushTimerRef.current !== null ||
				projectionFrameRef.current !== null
			) {
				return;
			}
			projectionFlushTimerRef.current = setTimeout(() => {
				projectionFlushTimerRef.current = null;
				projectionFrameRef.current = window.requestAnimationFrame(
					flushProjectionEvents,
				);
			}, mobileProjectionFlushMs);
			return;
		}
		if (projectionFrameRef.current !== null) {
			return;
		}
		projectionFrameRef.current = window.requestAnimationFrame(
			flushProjectionEvents,
		);
	}

	function queueProjectionEvent(event: CozEvent) {
		const pending = optimisticThreadRef.current;
		const eventThread =
			event.type === "thread.started" ? eventThreadPayload(event) : null;
		if (
			pending &&
			eventThread &&
			!pending.resolvedThreadId &&
			shouldResolveOptimisticThread(pending, eventThread)
		) {
			optimisticThreadRef.current = {
				...pending,
				resolvedThreadId: eventThread.id,
			};
			const wasSelected = selectedThreadIdRef.current === pending.id;
			const nextState = replaceOptimisticThreadState(
				projectionRef.current.state,
				{
					optimisticThreadId: pending.id,
					thread: eventThread,
				},
			);
			const nextDetail = rebaseOptimisticThreadDetail(
				projectionRef.current.detail,
				{
					optimisticThreadId: pending.id,
					thread: eventThread,
					turn: null,
				},
			);
			commitProjection({
				state: nextState,
				detail: nextDetail,
			});
			if (wasSelected) {
				setSelectedThreadId(eventThread.id);
				selectedThreadIdRef.current = eventThread.id;
				setSelectedProjectId(eventThread.cwd);
				if (nextDetail?.id === eventThread.id) {
					setDetailSubscription({
						threadId: eventThread.id,
						after: nextDetail.latestEventId,
					});
				}
			}
			return;
		}
		if (event.type === "turn.started") {
			const turn = eventTurnPayload(event);
			if (turn) {
				const matchingTurn = optimisticTurnsRef.current.find(
					(submission) =>
						submission.threadId === turn.threadId &&
						submission.draft.turn?.prompt ===
							(typeof turn.prompt === "string" ? turn.prompt : ""),
				);
				if (matchingTurn) {
					optimisticTurnsRef.current = optimisticTurnsRef.current.filter(
						(submission) => submission.turnId !== matchingTurn.turnId,
					);
					commitProjection(
						resolveOptimisticTurnDraft(projectionRef.current, {
							draft: matchingTurn.draft,
							turn,
						}),
					);
					return;
				}
			}
		}
		pendingEventsRef.current.push(event);
		scheduleProjectionFlush();
	}

	function advanceEventCursor(current: number, event: CozEvent) {
		return typeof event.id === "number" ? Math.max(current, event.id) : current;
	}

	function isResetEvent(event: CozEvent | ResetEvent): event is ResetEvent {
		return event.type === "events.reset";
	}

	function handleResetEvent(event: ResetEvent) {
		setArchivedRefreshKey((current) => current + 1);
		if (event.threadId && selectedThreadIdRef.current === event.threadId) {
			void loadThreadDetail(event.threadId).catch(() => {
				scheduleFallbackRefresh();
			});
			return;
		}
		void refresh(undefined, { loadDetail: true }).catch(() => {
			scheduleFallbackRefresh();
		});
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
			if (projectionFlushTimerRef.current) {
				clearTimeout(projectionFlushTimerRef.current);
				projectionFlushTimerRef.current = null;
			}
			pendingEventsRef.current = [];
		};
	}, []);

	useEventStreamSubscription({
		enabled: summaryEventsReady,
		subscriptionKey: summaryEventsReady ? "summary" : null,
		eventNames: streamEventNames,
		getPath: () => `/api/events?after=${summaryEventIdRef.current}`,
		onEvent: (rawEvent) => {
			try {
				const event = parseSseJsonEvent<CozEvent | ResetEvent>(rawEvent);
				if (isResetEvent(event)) {
					summaryEventIdRef.current = Math.max(
						summaryEventIdRef.current,
						event.latestEventId,
					);
					handleResetEvent(event);
					return;
				}
				summaryEventIdRef.current = advanceEventCursor(
					summaryEventIdRef.current,
					event,
				);
				if (
					event.type === "thread.lifecycle.updated" ||
					event.type === "thread.archived" ||
					event.type === "thread.unarchived" ||
					event.type === "thread.deleted" ||
					event.type === "threads.synced"
				) {
					setArchivedRefreshKey((current) => current + 1);
				}
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
		eventNames: streamEventNames,
		getPath: () => {
			if (!detailSubscription) {
				return "/api/events?after=0";
			}
			return `/api/threads/${encodeURIComponent(detailSubscription.threadId)}/events?after=${detailEventIdRef.current}`;
		},
		onEvent: (rawEvent) => {
			try {
				const event = parseSseJsonEvent<CozEvent | ResetEvent>(rawEvent);
				if (isResetEvent(event)) {
					detailEventIdRef.current = Math.max(
						detailEventIdRef.current,
						event.latestEventId,
					);
					handleResetEvent(event);
					return;
				}
				detailEventIdRef.current = advanceEventCursor(
					detailEventIdRef.current,
					event,
				);
				queueProjectionEvent(event);
			} catch {
				scheduleFallbackRefresh();
			}
		},
	});

	const shouldSearchArchivedThreads = queryMatchesArchivedThreads(threadQuery);

	useEffect(() => {
		historySearchSeqRef.current += 1;
		const searchSeq = historySearchSeqRef.current;
		const query = threadQuery.trim();
		if (!query) {
			setHistorySearchThreads([]);
			return;
		}
		const timer = window.setTimeout(() => {
			void searchThreadHistory({ query, limit: 100 })
				.then((page) => {
					if (historySearchSeqRef.current === searchSeq) {
						setHistorySearchThreads(
							page.results.map((result) => result.thread),
						);
					}
				})
				.catch((loadError: unknown) => {
					if (historySearchSeqRef.current === searchSeq) {
						setError(
							loadError instanceof Error
								? loadError.message
								: "Failed to search Codex history",
						);
					}
				});
		}, 250);
		return () => window.clearTimeout(timer);
	}, [threadQuery]);

	useEffect(() => {
		void archivedRefreshKey;
		archivedSearchSeqRef.current += 1;
		const searchSeq = archivedSearchSeqRef.current;
		if (!shouldSearchArchivedThreads) {
			setArchivedThreads([]);
			return;
		}
		void getThreadsPage({
			limit: archivedSearchPageSize,
			archived: true,
		})
			.then((page) => {
				if (archivedSearchSeqRef.current === searchSeq) {
					setArchivedThreads(page.threads);
				}
			})
			.catch((loadError: unknown) => {
				if (archivedSearchSeqRef.current !== searchSeq) {
					return;
				}
				setError(
					loadError instanceof Error
						? loadError.message
						: "Failed to load archived threads",
				);
			});
	}, [archivedRefreshKey, shouldSearchArchivedThreads]);

	const searchableThreads = useMemo(() => {
		if (!shouldSearchArchivedThreads) {
			return state.threads.filter(isThreadActive);
		}
		const byId = new Map<string, ControlThread>();
		for (const thread of state.threads) {
			byId.set(thread.id, thread);
		}
		for (const thread of archivedThreads) {
			byId.set(thread.id, thread);
		}
		for (const thread of historySearchThreads) {
			byId.set(thread.id, thread);
		}
		return [...byId.values()].filter(
			(thread) => isThreadActive(thread) || isThreadArchived(thread),
		);
	}, [
		archivedThreads,
		historySearchThreads,
		shouldSearchArchivedThreads,
		state.threads,
	]);

	const workbenchProjects = useMemo(
		() =>
			buildWorkbenchProjects(searchableThreads, state.defaultCwd, {
				dateTimeFormatMode,
			}),
		[searchableThreads, state.defaultCwd, dateTimeFormatMode],
	);
	const selectedProject =
		workbenchProjects.find((project) => project.id === selectedProjectId) ??
		workbenchProjects[0] ??
		null;
	const selectedWorkbenchThread = useMemo(() => {
		const selectedByThread =
			selectedProject?.threads.find(
				(threadSummary) => threadSummary.threadId === selectedThreadId,
			) ?? null;
		if (selectedByThread) {
			return selectedByThread;
		}
		return selectedProject?.threads[0] ?? null;
	}, [selectedProject, selectedThreadId]);
	const activeThreadId = selectedWorkbenchThread?.threadId ?? null;
	const activeThread = useMemo(
		() =>
			searchableThreads.find((thread) => thread.id === activeThreadId) ?? null,
		[activeThreadId, searchableThreads],
	);
	const activeDetail = detail?.id === activeThreadId ? detail : null;
	const promptTarget =
		composerMode === "thread" &&
		activeThread &&
		isThreadRuntimeActionable(activeThread)
			? "thread"
			: "new";
	const activeThreadPendingSubmission =
		activeThreadId === optimisticThreadRef.current?.id ||
		activeThreadId === optimisticThreadRef.current?.resolvedThreadId ||
		isOptimisticThreadId(activeThreadId) ||
		isOptimisticTurnId(activeThread?.activeTurnId);
	const trimmedWorkdir = workdir.trim();
	const canUseGoalMode =
		promptTarget === "new"
			? Boolean(trimmedWorkdir)
			: Boolean(activeThreadId) &&
				!activeThreadPendingSubmission &&
				activeThread?.status === "idle";
	const canSubmitTurnPrompt = goalMode
		? canUseGoalMode
		: promptTarget === "thread"
			? Boolean(activeThreadId) && !activeThreadPendingSubmission
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
		const projectThreadId = selectedWorkbenchThread?.threadId ?? null;
		if (projectThreadId === selectedThreadId) {
			return;
		}
		if (projectThreadId) {
			setComposerMode("thread");
			void selectThread(projectThreadId);
			return;
		}
		setComposerMode("new");
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
		selectedWorkbenchThread,
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

	useEffect(() => {
		if (!notice) {
			return;
		}
		const timer = window.setTimeout(() => {
			setNotice(null);
		}, transientAlertAutoDismissMs);
		return () => window.clearTimeout(timer);
	}, [notice]);

	useEffect(() => {
		if (!error) {
			return;
		}
		const timer = window.setTimeout(() => {
			setError(null);
		}, transientAlertAutoDismissMs);
		return () => window.clearTimeout(timer);
	}, [error]);

	const dismissNotice = useCallback(() => {
		setNotice(null);
	}, []);

	const dismissError = useCallback(() => {
		setError(null);
	}, []);

	const updateWorkdir = useCallback((value: string) => {
		setWorkdir(value);
		setWorkdirTouched(true);
	}, []);

	const updatePrompt = useCallback((value: string) => {
		setPrompt(value);
		writeStoredPromptDraft(value);
	}, []);

	const updateGoalMode = useCallback((value: boolean) => {
		setGoalMode(value);
	}, []);

	const selectWorkbenchThread = useCallback(
		(threadSummary: WorkbenchThread) => {
			const project = findProjectForThread(
				workbenchProjects,
				threadSummary.threadId,
			);
			if (project) {
				setSelectedProjectId(project.id);
			}
			setComposerMode("thread");
			setError(null);
			setNotice(null);
			void selectThread(threadSummary.threadId);
		},
		[selectThread, workbenchProjects],
	);

	const changeWorkbenchProject = useCallback(
		(projectId: string) => {
			const project =
				workbenchProjects.find((candidate) => candidate.id === projectId) ??
				null;
			setSelectedProjectId(projectId);
			setThreadQuery("");
			setError(null);
			setNotice(null);
			const nextThread = project?.threads[0] ?? null;
			if (nextThread) {
				setComposerMode("thread");
				void selectThread(nextThread.threadId);
				return;
			}
			setComposerMode("new");
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

	const enterNewThreadDraft = useCallback(
		(options: { clearPrompt?: boolean } = {}) => {
			setComposerMode("new");
			if (options.clearPrompt) {
				setPrompt("");
				writeStoredPromptDraft("");
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
				enterNewThreadDraft();
				return;
			}
			setComposerMode(mode);
		},
		[enterNewThreadDraft],
	);

	const createWorkbenchThread = useCallback(() => {
		enterNewThreadDraft({ clearPrompt: true });
	}, [enterNewThreadDraft]);

	async function runAction(
		label: string,
		action: () => Promise<unknown>,
		options: RunActionOptions = {},
	) {
		if (busyActionRef.current) {
			return;
		}
		const actionSelectionSeq = manualSelectionSeqRef.current;
		busyActionRef.current = label;
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
			busyActionRef.current = null;
			setBusyAction(null);
		}
	}

	async function createThreadOptimistically(currentPrompt: string) {
		const cwd = trimmedWorkdir;
		const submittedPrompt = currentPrompt.trim();
		const optimisticThreadId = createOptimisticThreadId();
		const creatingGoalMode = goalMode;
		const model = state.defaultModel;
		const draft = createOptimisticThreadDraft({
			id: optimisticThreadId,
			cwd,
			prompt: submittedPrompt,
			goalMode: creatingGoalMode,
			model,
			latestEventId: Math.max(
				summaryEventIdRef.current,
				detailEventIdRef.current,
			),
		});
		const submission: OptimisticThreadSubmission = {
			id: optimisticThreadId,
			cwd,
			name: draft.thread.name,
			createdAt: draft.thread.createdAt,
			resolvedThreadId: null,
		};

		optimisticThreadRef.current = submission;
		beginManualSelection();
		beginDetailLoad();
		setError(null);
		setNotice(null);
		setComposerMode("thread");
		setGoalMode(false);
		setWorkdir(cwd);
		setWorkdirTouched(false);
		setSelectedProjectId(cwd);
		setSelectedThreadId(optimisticThreadId);
		selectedThreadIdRef.current = optimisticThreadId;
		setDetailSubscription(null);
		commitProjection({
			state: insertOptimisticThreadState(
				projectionRef.current.state,
				draft.thread,
			),
			detail: draft.detail,
		});
		if (draft.detail.items[0]) {
			requestSubmittedPromptFocus(draft.detail.items[0].id);
		}

		try {
			const result = await createThread({
				cwd,
				prompt: submittedPrompt,
				goalMode: creatingGoalMode,
			});
			const thread = result.thread;
			if (!thread) {
				throw new Error("Thread was not created");
			}
			writeStoredPromptDraft("");

			const pending = optimisticThreadRef.current;
			if (pending?.id === optimisticThreadId) {
				optimisticThreadRef.current = null;
			}
			const wasSelected =
				selectedThreadIdRef.current === optimisticThreadId ||
				selectedThreadIdRef.current === thread.id ||
				selectedThreadIdRef.current === pending?.resolvedThreadId;
			const nextState = replaceOptimisticThreadState(
				projectionRef.current.state,
				{
					optimisticThreadId,
					thread,
				},
			);
			const nextDetail = rebaseOptimisticThreadDetail(
				projectionRef.current.detail,
				{
					optimisticThreadId,
					thread,
					turn: result.turn,
				},
			);
			commitProjection({
				state: nextState,
				detail: nextDetail,
			});
			setWorkdir(thread.cwd);
			setWorkdirTouched(false);

			if (wasSelected) {
				setComposerMode("thread");
				setSelectedThreadId(thread.id);
				selectedThreadIdRef.current = thread.id;
				const project = findProjectForThread(
					buildWorkbenchProjects(nextState.threads, nextState.defaultCwd),
					thread.id,
				);
				setSelectedProjectId(project?.id ?? thread.cwd);
			}

			if (
				selectedThreadIdRef.current === thread.id &&
				nextDetail?.id === thread.id
			) {
				setDetailSubscription({
					threadId: thread.id,
					after: nextDetail.latestEventId,
				});
			}
		} catch (actionError) {
			const message =
				actionError instanceof Error
					? actionError.message
					: "Failed to create thread";
			const pending = optimisticThreadRef.current;
			if (pending?.id === optimisticThreadId) {
				optimisticThreadRef.current = null;
			}
			if (pending?.resolvedThreadId) {
				commitProjection(
					failOptimisticThreadState(projectionRef.current, {
						optimisticThreadId: pending.resolvedThreadId,
						message,
					}),
				);
				setError(message);
				return;
			}
			const optimisticSelected =
				selectedThreadIdRef.current === optimisticThreadId;
			commitProjection(
				failOptimisticThreadState(projectionRef.current, {
					optimisticThreadId,
					message,
				}),
			);
			if (optimisticSelected) {
				setComposerMode("thread");
				setGoalMode(false);
				setWorkdir(submission.cwd);
				setWorkdirTouched(false);
				setSelectedProjectId(submission.cwd);
				setSelectedThreadId(optimisticThreadId);
				selectedThreadIdRef.current = optimisticThreadId;
			}
			setError(message);
		}
	}

	function removeOptimisticTurn(turnId: string) {
		optimisticTurnsRef.current = optimisticTurnsRef.current.filter(
			(submission) => submission.turnId !== turnId,
		);
	}

	async function startTurnOptimistically(input: {
		threadId: string;
		prompt: string;
		goalMode: boolean;
	}) {
		const currentThread =
			projectionRef.current.state.threads.find(
				(thread) => thread.id === input.threadId,
			) ?? activeThread;
		if (!currentThread) {
			return;
		}
		const submittedPrompt = input.prompt.trim();
		const draft = createOptimisticTurnDraft({
			thread: currentThread,
			prompt: submittedPrompt,
			goalMode: input.goalMode,
		});
		optimisticTurnsRef.current = [
			...optimisticTurnsRef.current,
			{
				turnId: draft.turnId,
				threadId: input.threadId,
				previousThread: currentThread,
				draft,
			},
		];
		commitProjection(applyOptimisticTurnDraft(projectionRef.current, draft));
		requestSubmittedPromptFocus(draft.itemId);
		setComposerMode("thread");
		setError(null);
		setNotice(null);

		try {
			const result = input.goalMode
				? await startGoal(input.threadId, submittedPrompt)
				: {
						turn: await startTurn(input.threadId, submittedPrompt),
						thread: null,
					};
			const turnStillPending = optimisticTurnsRef.current.some(
				(submission) => submission.turnId === draft.turnId,
			);
			removeOptimisticTurn(draft.turnId);
			if (turnStillPending) {
				commitProjection(
					resolveOptimisticTurnDraft(projectionRef.current, {
						draft,
						turn: result.turn,
						thread: result.thread,
					}),
				);
			}
			writeStoredPromptDraft("");
		} catch (actionError) {
			const message =
				actionError instanceof Error
					? actionError.message
					: input.goalMode
						? "Failed to start goal mode"
						: "Failed to start turn";
			const turnStillPending = optimisticTurnsRef.current.some(
				(submission) => submission.turnId === draft.turnId,
			);
			removeOptimisticTurn(draft.turnId);
			if (turnStillPending) {
				commitProjection(
					failOptimisticTurnDraft(projectionRef.current, {
						draft,
						previousThread: currentThread,
						message,
					}),
				);
			} else if (selectedThreadIdRef.current === input.threadId) {
				void loadThreadDetail(input.threadId).catch(() => {
					if (selectedThreadIdRef.current === input.threadId) {
						scheduleFallbackRefresh();
					}
				});
			}
			setError(message);
		}
	}

	async function archiveThreadOptimistically(threadId: string) {
		const thread =
			projectionRef.current.state.threads.find(
				(candidate) => candidate.id === threadId,
			) ?? activeThread;
		if (!thread) {
			return;
		}
		setBusyAction("Archiving thread");
		setError(null);
		setNotice(null);
		const nextState = removeOptimisticThreadState(
			projectionRef.current.state,
			threadId,
		);
		const fallbackThreadId =
			nextState.threads.find((candidate) => candidate.id !== threadId)?.id ??
			null;
		const archivedThreadWasSelected = selectedThreadIdRef.current === threadId;
		commitProjection({
			state: nextState,
			detail:
				projectionRef.current.detail?.id === threadId
					? null
					: projectionRef.current.detail,
		});
		if (archivedThreadWasSelected) {
			setSelectedThreadId(fallbackThreadId);
			selectedThreadIdRef.current = fallbackThreadId;
			if (fallbackThreadId) {
				const project = findProjectForThread(
					buildWorkbenchProjects(nextState.threads, nextState.defaultCwd),
					fallbackThreadId,
				);
				if (project) {
					setSelectedProjectId(project.id);
				}
				void loadThreadDetail(fallbackThreadId).catch(() => {
					if (selectedThreadIdRef.current === fallbackThreadId) {
						clearDetail();
					}
				});
			} else {
				beginDetailLoad();
				clearDetail();
			}
		}

		try {
			const archived = await archiveThread(threadId);
			if (queryMatchesArchivedThreads(threadQuery)) {
				setArchivedThreads((current) => {
					const next = current.filter(
						(candidate) => candidate.id !== archived.id,
					);
					return [archived, ...next];
				});
			}
			setComposerMode("thread");
			if (archived.lastOperationError) {
				setError(archived.lastOperationError);
			} else {
				setNotice("Thread archived");
			}
			void refresh(undefined, { loadDetail: true });
		} catch (actionError) {
			setError(
				actionError instanceof Error
					? actionError.message
					: "Failed to archive thread",
			);
			void refresh(undefined, { loadDetail: true });
		} finally {
			setBusyAction(null);
		}
	}

	async function unarchiveSelectedThread() {
		if (!activeThreadId) {
			return;
		}
		const threadId = activeThreadId;
		setBusyAction("Unarchiving thread");
		setError(null);
		setNotice(null);
		try {
			const unarchived = await unarchiveThread(threadId);
			setArchivedThreads((current) =>
				current.filter((candidate) => candidate.id !== threadId),
			);
			if (unarchived.lastOperationError) {
				setError(unarchived.lastOperationError);
			} else {
				setNotice("Thread unarchived");
			}
			await refresh(unarchived.id, { loadDetail: true });
		} catch (actionError) {
			setError(
				actionError instanceof Error
					? actionError.message
					: "Failed to unarchive thread",
			);
			await refresh(threadId, { loadDetail: true }).catch(() => undefined);
		} finally {
			setBusyAction(null);
		}
	}

	function applyThreadTagScoreLocally(
		threadId: string,
		tagScore: ThreadTagScore | null,
	) {
		const current = projectionRef.current;
		const threads = current.state.threads.map((thread) =>
			thread.id === threadId ? { ...thread, tagScore } : thread,
		);
		const detail =
			current.detail?.id === threadId
				? { ...current.detail, tagScore }
				: current.detail;
		commitProjection({
			state:
				threads === current.state.threads
					? current.state
					: {
							...current.state,
							threads,
						},
			detail,
		});
		setArchivedThreads((threads) =>
			threads.map((thread) =>
				thread.id === threadId ? { ...thread, tagScore } : thread,
			),
		);
	}

	async function updateSelectedThreadTagScore(tagScore: ThreadTagScore | null) {
		if (!activeThreadId || !activeThread) {
			return;
		}
		const threadId = activeThreadId;
		const previousScore = activeThread.tagScore;
		if (previousScore === tagScore) {
			return;
		}
		applyThreadTagScoreLocally(threadId, tagScore);
		setError(null);
		setNotice(null);
		try {
			const thread = await setThreadTagScore(threadId, tagScore);
			applyThreadTagScoreLocally(thread.id, thread.tagScore);
		} catch (actionError) {
			applyThreadTagScoreLocally(threadId, previousScore);
			setError(
				actionError instanceof Error
					? actionError.message
					: "Failed to update thread score",
			);
		}
	}

	function executePrompt() {
		if (!canSubmitPrompt) {
			return;
		}
		const currentPrompt = prompt;
		if (document.activeElement instanceof HTMLElement) {
			document.activeElement.blur();
		}

		if (goalMode && promptTarget === "thread") {
			if (!activeThreadId || !canUseGoalMode) {
				return;
			}
			const threadId = activeThreadId;
			setPrompt("");
			writeStoredPromptDraft("");
			setComposerMode("thread");
			setGoalMode(false);
			void startTurnOptimistically({
				threadId,
				prompt: currentPrompt,
				goalMode: true,
			});
			return;
		}

		setPrompt("");
		writeStoredPromptDraft("");

		if (promptTarget === "thread" && activeThreadId) {
			const threadId = activeThreadId;
			void startTurnOptimistically({
				threadId,
				prompt: currentPrompt,
				goalMode: false,
			});
			return;
		}

		void createThreadOptimistically(currentPrompt);
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
			"Resuming thread",
			async () => {
				const thread = await resumeThread(threadId);
				return thread.id;
			},
			{ successMessage: "Thread resumed" },
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

	function compactSelectedThread() {
		if (!activeThreadId) {
			return;
		}
		const threadId = activeThreadId;
		void runAction(
			"Compacting thread",
			async () => {
				const turn = await compactThread(threadId);
				setComposerMode("thread");
				return turn.threadId;
			},
			{
				selectResult: true,
				successMessage: "Compact started",
			},
		);
	}

	function archiveSelectedThread() {
		if (!activeThreadId) {
			return;
		}
		void archiveThreadOptimistically(activeThreadId);
	}

	function listSelectedBackgroundTerminals() {
		if (!activeThreadId) {
			return;
		}
		const threadId = activeThreadId;
		void runAction(
			"Listing background terminals",
			async () => {
				const page = await listBackgroundTerminals(threadId);
				setNotice(backgroundTerminalSummary(page.terminals));
			},
			{ successMessage: undefined },
		);
	}

	function cleanSelectedBackgroundTerminals() {
		if (!activeThreadId) {
			return;
		}
		const threadId = activeThreadId;
		void runAction(
			"Stopping background terminals",
			async () => {
				await cleanBackgroundTerminals(threadId);
				return threadId;
			},
			{ successMessage: "Background terminals stopped" },
		);
	}

	function restartCodexAppServerFromSettings() {
		void runAction(
			"Restarting app-server",
			async () => {
				await restartCodexAppServer();
			},
			{ successMessage: "Codex app-server restarted" },
		);
	}

	async function refreshThreadHistory() {
		if (refreshingHistory) {
			return;
		}
		setRefreshingHistory(true);
		try {
			await syncThreadHistory({ limit: 200 });
			await refresh(selectedThreadIdRef.current, { loadDetail: false });
			setNotice("Codex history refreshed");
			setError(null);
		} catch (refreshError) {
			setError(
				refreshError instanceof Error
					? refreshError.message
					: "Failed to refresh Codex history",
			);
		} finally {
			setRefreshingHistory(false);
		}
	}

	return (
		<MotionConfig reducedMotion="user">
			<DashboardLayout
				projects={workbenchProjects}
				selectedProjectId={selectedProjectId}
				selectedThreadKey={selectedWorkbenchThread?.id ?? activeThreadId}
				threadSummary={selectedWorkbenchThread}
				detail={activeDetail}
				selectedThread={activeThread}
				selectedThreadId={activeThreadId}
				navigatorVisible={navigatorVisible}
				inspectorVisible={inspectorVisible}
				terminalVisible={terminalVisible}
				wrapThreadContent={wrapThreadContent}
				loadingEarlierTranscript={loadingEarlierTranscript}
				themeMode={themeMode}
				onThemeModeChange={setThemeMode}
				displayScale={displayScale}
				onDisplayScaleChange={(value) =>
					setDisplayScale(clampDisplayScale(value))
				}
				onThreadTagScoreChange={(value) => {
					void updateSelectedThreadTagScore(value);
				}}
				threadQuery={threadQuery}
				defaultCwd={state.defaultCwd}
				defaultModel={state.defaultModel}
				workdir={workdir}
				busy={busy}
				busyAction={busyAction}
				notice={notice}
				onDismissNotice={dismissNotice}
				error={error}
				onDismissError={dismissError}
				prompt={prompt}
				promptTarget={promptTarget}
				goalMode={goalMode}
				canUseGoalMode={canUseGoalMode}
				canSubmitPrompt={canSubmitPrompt}
				submittedPromptFocusTarget={submittedPromptFocusTarget}
				onNavigatorVisibleChange={setNavigatorVisible}
				onInspectorVisibleChange={setInspectorVisible}
				onWrapThreadContentChange={setWrapThreadContent}
				onProjectChange={changeWorkbenchProject}
				onSelectThread={selectWorkbenchThread}
				onCreateThread={createWorkbenchThread}
				onThreadQueryChange={setThreadQuery}
				onRefreshThreads={() => void refreshThreadHistory()}
				refreshingThreads={refreshingHistory}
				onTerminalVisibleChange={setTerminalVisible}
				onPromptChange={updatePrompt}
				onPromptKeyDown={handlePromptKeyDown}
				onPromptSubmit={submitPrompt}
				onModeChange={changeComposerMode}
				onWorkdirChange={updateWorkdir}
				onGoalModeChange={updateGoalMode}
				onInterrupt={interruptSelectedThread}
				onResume={resumeSelectedThread}
				onFork={forkSelectedThread}
				onCompact={compactSelectedThread}
				onArchive={archiveSelectedThread}
				onUnarchive={() => void unarchiveSelectedThread()}
				onListBackgroundTerminals={listSelectedBackgroundTerminals}
				onCleanBackgroundTerminals={cleanSelectedBackgroundTerminals}
				onLoadEarlierTranscript={loadEarlierTranscriptItems}
				onRestartCodexAppServer={restartCodexAppServerFromSettings}
				dateTimeFormatMode={dateTimeFormatMode}
			/>
			<Suspense fallback={null}>
				{terminalVisible ? (
					<div data-print-exclude>
						<TerminalDock
							themeMode={themeMode}
							visible={terminalVisible}
							onClose={() => setTerminalVisible(false)}
						/>
					</div>
				) : null}
			</Suspense>
		</MotionConfig>
	);
}
