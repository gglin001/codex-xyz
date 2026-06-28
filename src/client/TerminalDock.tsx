import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { Terminal as XTerm } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { AnimatePresence, motion } from "framer-motion";
import { Play, RotateCw, Square, X } from "lucide-react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TerminalEvent, TerminalSnapshot } from "../server/domain.js";
import {
	resizeTerminal,
	startTerminal,
	terminateTerminal,
	writeTerminalInput,
} from "./api.js";
import { IconButton, Pill } from "./components/uiPrimitives.js";
import { cn, layer, motionPresets, tone, ui } from "./designSystem.js";
import { openEventStream, parseSseJsonEvent } from "./eventStream.js";
import { type ThemeMode, terminalTheme } from "./theme.js";

type TerminalDockProps = {
	themeMode: ThemeMode;
	visible: boolean;
	onClose: () => void;
};

type ConnectionStatus =
	| "idle"
	| "connecting"
	| "connected"
	| "reconnecting"
	| "offline";
type TerminalTransport = "idle" | "sse";
type TerminalRenderer = "canvas" | "webgl";

type TerminalClientMetrics = {
	transport: TerminalTransport;
	renderer: TerminalRenderer;
	outputEvents: number;
	outputChars: number;
	outputFrames: number;
	outputWriteMs: number;
	inputFrames: number;
	inputChars: number;
	reconnects: number;
};

const reconnectDelayMs = 1_200;
const inputFlushMs = 8;
const resizeFlushMs = 100;
const metricsCommitMs = 500;
const desktopMargin = 16;
const desktopDefaultWidth = 560;
const desktopDefaultHeight = 320;
const desktopMinWidth = 360;
const desktopMinHeight = 220;
const desktopSideRailAvoidanceWidth = 332;
const desktopSideRailAvoidanceViewport = 960;

type DesktopFrame = {
	x: number;
	y: number;
	width: number;
	height: number;
};

const terminalStatusClass: Record<string, string> = {
	idle: tone.neutral.badge,
	connected: tone.running.badge,
	running: tone.running.badge,
	starting: tone.selected.badge,
	connecting: tone.selected.badge,
	reconnecting: tone.selected.badge,
	exited: tone.neutral.badge,
	failed: tone.error.badge,
	offline: tone.error.badge,
};

const initialTerminalClientMetrics: TerminalClientMetrics = {
	transport: "idle",
	renderer: "canvas",
	outputEvents: 0,
	outputChars: 0,
	outputFrames: 0,
	outputWriteMs: 0,
	inputFrames: 0,
	inputChars: 0,
	reconnects: 0,
};

function statusLabel(
	snapshot: TerminalSnapshot | null,
	connection: ConnectionStatus,
) {
	if (connection === "connecting" || connection === "reconnecting") {
		return connection;
	}
	if (!snapshot) {
		return connection === "offline" ? "offline" : "idle";
	}
	return snapshot.status;
}

function formatMs(value: number) {
	if (!Number.isFinite(value) || value <= 0) {
		return "0ms";
	}
	return `${value.toFixed(value >= 10 ? 0 : 1)}ms`;
}

function terminalMetricsTitle(
	metrics: TerminalClientMetrics,
	snapshot: TerminalSnapshot | null,
) {
	const stats = snapshot?.stats;
	const averageWriteMs =
		metrics.outputFrames > 0 ? metrics.outputWriteMs / metrics.outputFrames : 0;
	return [
		`transport: ${metrics.transport}`,
		`renderer: ${metrics.renderer}`,
		`client output events: ${metrics.outputEvents}`,
		`client output chars: ${metrics.outputChars}`,
		`client xterm writes: ${metrics.outputFrames}`,
		`client average write: ${formatMs(averageWriteMs)}`,
		`client input frames: ${metrics.inputFrames}`,
		`server pty chunks: ${stats?.ptyOutputChunks ?? 0}`,
		`server output flushes: ${stats?.outputFlushes ?? 0}`,
		`server model pending writes: ${stats?.modelPendingWrites ?? 0}`,
		`server output paused: ${stats?.outputPaused ? "yes" : "no"}`,
	].join("\n");
}

function defaultDesktopFrame(): DesktopFrame {
	if (typeof window === "undefined") {
		return {
			x: desktopMargin,
			y: desktopMargin,
			width: desktopDefaultWidth,
			height: desktopDefaultHeight,
		};
	}
	const width = Math.min(
		desktopDefaultWidth,
		Math.max(desktopMinWidth, window.innerWidth - desktopMargin * 2),
	);
	const height = Math.min(
		desktopDefaultHeight,
		Math.max(desktopMinHeight, window.innerHeight - desktopMargin * 2),
	);
	const maxX = Math.max(
		desktopMargin,
		window.innerWidth - width - desktopMargin,
	);
	const centeredX = Math.round((window.innerWidth - width) / 2);
	const minimumX =
		window.innerWidth >= desktopSideRailAvoidanceViewport
			? desktopSideRailAvoidanceWidth
			: desktopMargin;
	return {
		x: Math.min(maxX, Math.max(minimumX, centeredX)),
		y: Math.max(desktopMargin, window.innerHeight - height - desktopMargin),
		width,
		height,
	};
}

function clampDesktopFrame(frame: DesktopFrame): DesktopFrame {
	if (typeof window === "undefined") {
		return frame;
	}
	const maxWidth = Math.max(
		desktopMinWidth,
		window.innerWidth - desktopMargin * 2,
	);
	const maxHeight = Math.max(
		desktopMinHeight,
		window.innerHeight - desktopMargin * 2,
	);
	const width = Math.min(maxWidth, Math.max(desktopMinWidth, frame.width));
	const height = Math.min(maxHeight, Math.max(desktopMinHeight, frame.height));
	return {
		x: Math.min(
			Math.max(desktopMargin, frame.x),
			Math.max(desktopMargin, window.innerWidth - width - desktopMargin),
		),
		y: Math.min(
			Math.max(desktopMargin, frame.y),
			Math.max(desktopMargin, window.innerHeight - height - desktopMargin),
		),
		width,
		height,
	};
}

function useMediaQuery(query: string) {
	const [matches, setMatches] = useState(() => {
		if (typeof window === "undefined") {
			return false;
		}
		return window.matchMedia(query).matches;
	});

	useEffect(() => {
		const media = window.matchMedia(query);
		const update = () => setMatches(media.matches);
		update();
		media.addEventListener("change", update);
		return () => {
			media.removeEventListener("change", update);
		};
	}, [query]);

	return matches;
}

const spring = motionPresets.spring;
const sheetSpring = motionPresets.sheet;

function TerminalActions({
	onStartOrAttach,
	onStop,
	canStop,
	startActionLabel,
}: {
	onStartOrAttach: () => void;
	onStop: () => void;
	canStop: boolean;
	startActionLabel: string;
}) {
	return (
		<div className="flex shrink-0 items-center gap-1">
			<IconButton
				title={startActionLabel}
				aria-label={startActionLabel}
				onClick={onStartOrAttach}
			>
				{canStop ? <RotateCw size={14} /> : <Play size={14} />}
			</IconButton>
			<IconButton
				title="Stop terminal process"
				aria-label="Stop terminal process"
				disabled={!canStop}
				onClick={onStop}
			>
				<Square size={14} />
			</IconButton>
		</div>
	);
}

export function TerminalDock({
	themeMode,
	visible,
	onClose,
}: TerminalDockProps) {
	const containerRef = useRef<HTMLDivElement | null>(null);
	const desktopInteractionRef = useRef<{
		mode: "move" | "resize";
		pointerId: number;
		startClientX: number;
		startClientY: number;
		startFrame: DesktopFrame;
	} | null>(null);
	const terminalRef = useRef<XTerm | null>(null);
	const fitAddonRef = useRef<FitAddon | null>(null);
	const startThreadRef = useRef<(() => Promise<void>) | null>(null);
	const inputFlushRef = useRef<(() => void) | null>(null);
	const [snapshot, setSnapshot] = useState<TerminalSnapshot | null>(null);
	const [connection, setConnection] = useState<ConnectionStatus>("idle");
	const [error, setError] = useState<string | null>(null);
	const [metrics, setMetrics] = useState<TerminalClientMetrics>(
		initialTerminalClientMetrics,
	);
	const [desktopFrame, setDesktopFrame] = useState<DesktopFrame>(() =>
		defaultDesktopFrame(),
	);
	const themeOptions = useMemo(() => terminalTheme(themeMode), [themeMode]);
	const isMobileSheet = useMediaQuery("(max-width: 767px)");
	const canStop =
		snapshot?.status === "running" || snapshot?.status === "starting";
	const label = statusLabel(snapshot, connection);
	const metricsTitle = terminalMetricsTitle(metrics, snapshot);
	const startActionLabel = canStop ? "Reconnect terminal" : "Start terminal";

	useEffect(() => {
		if (isMobileSheet) {
			return;
		}
		const handleResize = () => {
			setDesktopFrame((current) => clampDesktopFrame(current));
		};
		window.addEventListener("resize", handleResize);
		handleResize();
		return () => {
			window.removeEventListener("resize", handleResize);
		};
	}, [isMobileSheet]);

	useEffect(() => {
		const terminal = terminalRef.current;
		if (terminal) {
			terminal.options.theme = themeOptions;
		}
	}, [themeOptions]);

	useEffect(() => {
		if (!visible || !containerRef.current) {
			return;
		}

		let disposed = false;
		let closeEventStream: (() => void) | null = null;
		let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
		let resizeTimer: ReturnType<typeof setTimeout> | null = null;
		let metricsTimer: ReturnType<typeof setInterval> | null = null;
		let outputFrame: number | null = null;
		let pendingOutputChunks: string[] = [];
		let pendingOutputChars = 0;
		let outputWriteInProgress = false;
		let inputTimer: ReturnType<typeof setTimeout> | null = null;
		let inputBuffer = "";
		let inputChain: Promise<void> = Promise.resolve();
		let lastSequence = 0;
		const clientMetrics: TerminalClientMetrics = {
			...initialTerminalClientMetrics,
		};

		const terminal = new XTerm({
			cursorBlink: true,
			cursorInactiveStyle: "block",
			fontFamily:
				'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
			fontSize: 12,
			lineHeight: 1.18,
			letterSpacing: 0,
			scrollback: 2_000,
			smoothScrollDuration: 0,
			theme: themeOptions,
			allowTransparency: false,
		});
		const fitAddon = new FitAddon();
		terminal.loadAddon(fitAddon);
		terminal.open(containerRef.current);
		let webglAddon: WebglAddon | null = null;
		try {
			webglAddon = new WebglAddon();
			webglAddon.onContextLoss(() => {
				webglAddon?.dispose();
				webglAddon = null;
				clientMetrics.renderer = "canvas";
				commitMetrics();
			});
			terminal.loadAddon(webglAddon);
			clientMetrics.renderer = "webgl";
		} catch {
			webglAddon?.dispose();
			webglAddon = null;
			clientMetrics.renderer = "canvas";
		}
		terminalRef.current = terminal;
		fitAddonRef.current = fitAddon;
		commitMetrics();

		function commitMetrics() {
			if (!disposed) {
				setMetrics({ ...clientMetrics });
			}
		}

		metricsTimer = setInterval(commitMetrics, metricsCommitMs);

		function writeOutputNow() {
			outputFrame = null;
			if (outputWriteInProgress || pendingOutputChunks.length === 0) {
				return;
			}
			const chunks = pendingOutputChunks;
			const chars = pendingOutputChars;
			const data = chunks.length === 1 ? chunks[0] : chunks.join("");
			pendingOutputChunks = [];
			pendingOutputChars = 0;
			outputWriteInProgress = true;
			const startedAt = performance.now();
			terminal.write(data, () => {
				outputWriteInProgress = false;
				clientMetrics.outputFrames += 1;
				clientMetrics.outputWriteMs += performance.now() - startedAt;
				clientMetrics.outputChars += chars;
				if (pendingOutputChunks.length > 0 && !disposed) {
					scheduleOutputWrite();
				}
			});
		}

		function scheduleOutputWrite() {
			if (outputFrame !== null) {
				return;
			}
			outputFrame = window.requestAnimationFrame(writeOutputNow);
		}

		function queueOutput(data: string) {
			clientMetrics.outputEvents += 1;
			pendingOutputChunks.push(data);
			pendingOutputChars += data.length;
			scheduleOutputWrite();
		}

		function flushHttpInput() {
			if (inputTimer) {
				clearTimeout(inputTimer);
				inputTimer = null;
			}
			const data = inputBuffer;
			if (!data) {
				return;
			}
			inputBuffer = "";
			inputChain = inputChain
				.then(() => writeTerminalInput(data))
				.catch((inputError: unknown) => {
					if (!disposed) {
						setError(
							inputError instanceof Error
								? inputError.message
								: "Failed to write terminal input",
						);
					}
				});
		}

		inputFlushRef.current = flushHttpInput;

		function queueHttpInput(data: string) {
			inputBuffer += data;
			if (inputBuffer.length >= 4096) {
				flushHttpInput();
				return;
			}
			if (!inputTimer) {
				inputTimer = setTimeout(flushHttpInput, inputFlushMs);
			}
		}

		function queueInput(data: string) {
			clientMetrics.inputFrames += 1;
			clientMetrics.inputChars += data.length;
			queueHttpInput(data);
		}

		function terminalSize() {
			fitAddon.fit();
			return {
				cols: terminal.cols,
				rows: terminal.rows,
			};
		}

		function scheduleResize() {
			if (resizeTimer) {
				clearTimeout(resizeTimer);
			}
			resizeTimer = setTimeout(() => {
				resizeTimer = null;
				try {
					const size = terminalSize();
					void resizeTerminal(size)
						.then((nextSnapshot) => {
							if (!disposed) {
								setSnapshot(nextSnapshot);
							}
						})
						.catch(() => {});
				} catch {
					// A hidden or detached terminal can briefly report an invalid layout.
				}
			}, resizeFlushMs);
		}

		function restoreSnapshot(nextSnapshot: TerminalSnapshot) {
			lastSequence = nextSnapshot.sequence;
			setSnapshot(nextSnapshot);
			terminal.reset();
			return new Promise<void>((resolve) => {
				if (!nextSnapshot.screen) {
					resolve();
					return;
				}
				terminal.write(nextSnapshot.screen, resolve);
			});
		}

		function handleTerminalEvent(rawEvent: Event) {
			try {
				const event = parseSseJsonEvent<TerminalEvent>(rawEvent);
				lastSequence = Math.max(lastSequence, event.sequence);
				if (event.type === "terminal.output") {
					queueOutput(event.data);
					return;
				}
				setSnapshot(event.snapshot);
			} catch {
				setError("Failed to read terminal event");
			}
		}

		function scheduleReconnect() {
			if (disposed) {
				return;
			}
			clientMetrics.reconnects += 1;
			setConnection("offline");
			reconnectTimer = setTimeout(
				() => connect(lastSequence),
				reconnectDelayMs,
			);
		}

		function closeTransports() {
			closeEventStream?.();
			closeEventStream = null;
		}

		function connectSse(afterSequence: number) {
			closeTransports();
			closeEventStream = openEventStream({
				path: `/api/terminal/events?after=${afterSequence}`,
				eventNames: ["terminal.output", "terminal.status"],
				onEvent: handleTerminalEvent,
				onOpen: () => {
					if (!disposed) {
						clientMetrics.transport = "sse";
						commitMetrics();
						setConnection("connected");
						setError(null);
					}
				},
				onError: () => {
					closeTransports();
					scheduleReconnect();
				},
			});
		}

		function connect(afterSequence: number) {
			closeTransports();
			if (reconnectTimer) {
				clearTimeout(reconnectTimer);
				reconnectTimer = null;
			}
			if (!disposed) {
				setConnection(afterSequence > 0 ? "reconnecting" : "connecting");
			}
			connectSse(afterSequence);
		}

		async function startOrAttach() {
			try {
				setConnection("connecting");
				setError(null);
				const nextSnapshot = await startTerminal(terminalSize());
				if (disposed) {
					return;
				}
				await restoreSnapshot(nextSnapshot);
				if (!disposed) {
					connect(nextSnapshot.sequence);
					terminal.focus();
				}
			} catch (startError) {
				if (!disposed) {
					setConnection("offline");
					setError(
						startError instanceof Error
							? startError.message
							: "Failed to start terminal",
					);
				}
			}
		}

		const dataDisposable = terminal.onData(queueInput);
		const binaryDisposable = terminal.onBinary(queueInput);
		const resizeObserver = new ResizeObserver(scheduleResize);
		resizeObserver.observe(containerRef.current);
		startThreadRef.current = startOrAttach;

		window.requestAnimationFrame(() => {
			if (!disposed) {
				void startOrAttach();
			}
		});

		return () => {
			disposed = true;
			startThreadRef.current = null;
			inputFlushRef.current = null;
			flushHttpInput();
			if (reconnectTimer) {
				clearTimeout(reconnectTimer);
			}
			if (resizeTimer) {
				clearTimeout(resizeTimer);
			}
			if (inputTimer) {
				clearTimeout(inputTimer);
			}
			if (metricsTimer) {
				clearInterval(metricsTimer);
			}
			if (outputFrame !== null) {
				window.cancelAnimationFrame(outputFrame);
			}
			closeTransports();
			resizeObserver.disconnect();
			dataDisposable.dispose();
			binaryDisposable.dispose();
			webglAddon?.dispose();
			fitAddon.dispose();
			terminal.dispose();
			if (terminalRef.current === terminal) {
				terminalRef.current = null;
			}
			if (fitAddonRef.current === fitAddon) {
				fitAddonRef.current = null;
			}
			setConnection("idle");
		};
	}, [themeOptions, visible]);

	const startOrAttach = useCallback(() => {
		void startThreadRef.current?.();
	}, []);

	const stopTerminal = useCallback(() => {
		inputFlushRef.current?.();
		void terminateTerminal()
			.then((nextSnapshot) => {
				setSnapshot(nextSnapshot);
				setError(null);
			})
			.catch((stopError: unknown) => {
				setError(
					stopError instanceof Error
						? stopError.message
						: "Failed to stop terminal",
				);
			});
	}, []);

	const finishDesktopInteraction = useCallback(
		(event: ReactPointerEvent<HTMLElement>) => {
			const interaction = desktopInteractionRef.current;
			if (!interaction || interaction.pointerId !== event.pointerId) {
				return;
			}
			desktopInteractionRef.current = null;
			event.currentTarget.releasePointerCapture(event.pointerId);
		},
		[],
	);

	const updateDesktopInteraction = useCallback(
		(event: ReactPointerEvent<HTMLElement>) => {
			const interaction = desktopInteractionRef.current;
			if (!interaction || interaction.pointerId !== event.pointerId) {
				return;
			}
			event.preventDefault();
			const deltaX = event.clientX - interaction.startClientX;
			const deltaY = event.clientY - interaction.startClientY;
			if (interaction.mode === "move") {
				setDesktopFrame(
					clampDesktopFrame({
						...interaction.startFrame,
						x: interaction.startFrame.x + deltaX,
						y: interaction.startFrame.y + deltaY,
					}),
				);
				return;
			}
			setDesktopFrame(
				clampDesktopFrame({
					...interaction.startFrame,
					width: interaction.startFrame.width + deltaX,
					height: interaction.startFrame.height + deltaY,
				}),
			);
		},
		[],
	);

	const startDesktopMove = useCallback(
		(event: ReactPointerEvent<HTMLDivElement>) => {
			if (isMobileSheet || event.button !== 0) {
				return;
			}
			if ((event.target as HTMLElement).closest("button")) {
				return;
			}
			event.preventDefault();
			desktopInteractionRef.current = {
				mode: "move",
				pointerId: event.pointerId,
				startClientX: event.clientX,
				startClientY: event.clientY,
				startFrame: desktopFrame,
			};
			event.currentTarget.setPointerCapture(event.pointerId);
		},
		[desktopFrame, isMobileSheet],
	);

	const startDesktopResize = useCallback(
		(event: ReactPointerEvent<HTMLButtonElement>) => {
			if (isMobileSheet || event.button !== 0) {
				return;
			}
			event.preventDefault();
			desktopInteractionRef.current = {
				mode: "resize",
				pointerId: event.pointerId,
				startClientX: event.clientX,
				startClientY: event.clientY,
				startFrame: desktopFrame,
			};
			event.currentTarget.setPointerCapture(event.pointerId);
		},
		[desktopFrame, isMobileSheet],
	);

	const header = (
		<div
			className={cn(
				"grid min-h-9 shrink-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 px-2.5 py-1 md:cursor-move",
				ui.panelBand,
			)}
			onPointerDown={startDesktopMove}
			onPointerMove={updateDesktopInteraction}
			onPointerUp={finishDesktopInteraction}
			onPointerCancel={finishDesktopInteraction}
		>
			<div className="flex min-w-0 items-center gap-1.5 text-[11px] leading-4">
				<span
					className={cn(
						"shrink-0 rounded-full px-1.5 py-1 text-[11px] font-semibold leading-none",
						terminalStatusClass[label] ?? terminalStatusClass.idle,
					)}
				>
					{label}
				</span>
				{snapshot?.pid ? (
					<Pill className="hidden sm:inline-flex">pid {snapshot.pid}</Pill>
				) : null}
				<Pill
					className="hidden max-w-[30vw] truncate font-mono xl:inline-flex"
					title={metricsTitle}
				>
					diagnostics
				</Pill>
				{error ? (
					<span
						className={cn(
							"hidden max-w-[26vw] truncate rounded-full px-2 py-1 text-[11px] font-medium sm:inline-flex",
							tone.error.badge,
						)}
					>
						{error}
					</span>
				) : null}
			</div>
			<div className="flex shrink-0 items-center gap-1">
				<TerminalActions
					onStartOrAttach={startOrAttach}
					onStop={stopTerminal}
					canStop={canStop}
					startActionLabel={startActionLabel}
				/>
				<IconButton
					title="Hide terminal"
					aria-label="Hide terminal"
					onClick={onClose}
				>
					<X size={14} />
				</IconButton>
			</div>
		</div>
	);

	const terminalCanvas = (
		<div className="relative min-h-[160px] flex-1 bg-terminal">
			<div
				className="h-full p-2 [&_.xterm]:h-full [&_.xterm-screen]:will-change-transform [&_.xterm-viewport]:!bg-transparent"
				ref={containerRef}
			/>
			<div className="chrome-edge-fade chrome-edge-fade-short chrome-edge-fade-terminal chrome-edge-fade-top" />
			<div className="chrome-edge-fade chrome-edge-fade-short chrome-edge-fade-terminal chrome-edge-fade-bottom" />
		</div>
	);

	const resizeHandle = (
		<button
			type="button"
			className={cn(
				"absolute bottom-1 right-1 hidden h-6 w-6 cursor-nwse-resize items-end justify-end md:flex",
				ui.compactIconState,
			)}
			title="Resize terminal"
			aria-label="Resize terminal"
			onPointerDown={startDesktopResize}
			onPointerMove={updateDesktopInteraction}
			onPointerUp={finishDesktopInteraction}
			onPointerCancel={finishDesktopInteraction}
		>
			<span
				className="mb-1 mr-1 h-2.5 w-2.5 rounded-[4px] bg-current opacity-45"
				aria-hidden="true"
			/>
		</button>
	);

	return (
		<AnimatePresence>
			{visible ? (
				<motion.div
					key="terminal-root"
					className={cn(
						"fixed inset-x-0 bottom-0 top-[var(--mobile-sheet-top)] md:inset-0 md:pointer-events-none",
						layer.overlayZ,
					)}
					initial={{ opacity: 0 }}
					animate={{ opacity: 1 }}
					exit={{ opacity: 0 }}
					transition={spring}
				>
					<motion.div
						key="terminal-backdrop"
						className={cn("absolute inset-0 md:hidden", ui.overlay)}
						initial={{ opacity: 0 }}
						animate={{ opacity: 1 }}
						exit={{ opacity: 0 }}
						transition={spring}
						onClick={onClose}
					/>

					<motion.section
						className={cn(layer.mobileTerminalSheet, ui.popover)}
						style={
							isMobileSheet
								? undefined
								: {
										left: desktopFrame.x,
										top: desktopFrame.y,
										width: desktopFrame.width,
										height: desktopFrame.height,
									}
						}
						initial={
							isMobileSheet
								? { y: -6, opacity: 0 }
								: { opacity: 0, y: 24, scale: 0.97 }
						}
						animate={{
							y: 0,
							opacity: 1,
							scale: 1,
						}}
						exit={
							isMobileSheet
								? { y: -6, opacity: 0 }
								: { opacity: 0, y: 24, scale: 0.97 }
						}
						transition={sheetSpring}
						onClick={(event) => event.stopPropagation()}
						aria-label="Terminal"
					>
						{header}
						{terminalCanvas}
						{resizeHandle}
					</motion.section>
				</motion.div>
			) : null}
		</AnimatePresence>
	);
}
