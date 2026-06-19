import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { Terminal as XTerm } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { Play, RotateCw, Square, Terminal as TerminalIcon, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  apiUrl,
  resizeTerminal,
  startTerminal,
  terminateTerminal,
  writeTerminalInput
} from "./api.js";
import { cn, iconButtonClass, pillClass } from "./classNames.js";
import type { TerminalEvent, TerminalSnapshot } from "../server/domain.js";

type TerminalDockProps = {
  visible: boolean;
  theme: "dark" | "light";
  onClose: () => void;
};

type ConnectionStatus = "idle" | "connecting" | "connected" | "reconnecting" | "offline";
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

const terminalStatusClass: Record<string, string> = {
  idle: "bg-chip text-chip-fg",
  connected: "bg-running text-running-fg",
  running: "bg-running text-running-fg",
  starting: "bg-stale text-stale-fg",
  connecting: "bg-stale text-stale-fg",
  reconnecting: "bg-stale text-stale-fg",
  exited: "bg-chip text-chip-fg",
  failed: "bg-attention text-attention-fg",
  offline: "bg-attention text-attention-fg"
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
  reconnects: 0
};

function terminalTheme(mode: "dark" | "light") {
  if (mode === "light") {
    return {
      background: "#ffffff",
      foreground: "#2f2f2f",
      cursor: "#111111",
      selectionBackground: "#dedede",
      black: "#111111",
      red: "#b42318",
      green: "#1d684f",
      yellow: "#8a5a12",
      blue: "#255a8a",
      magenta: "#5b42a8",
      cyan: "#4a4a4a",
      white: "#ededed"
    };
  }
  return {
    background: "#0b0b0b",
    foreground: "#ececec",
    cursor: "#f5f5f5",
    selectionBackground: "#333333",
    black: "#111111",
    red: "#ffb4b4",
    green: "#a8e6cf",
    yellow: "#f1c56f",
    blue: "#c8d7ff",
    magenta: "#ccb7ff",
    cyan: "#c8c8c8",
    white: "#f5f5f5"
  };
}

function statusLabel(snapshot: TerminalSnapshot | null, connection: ConnectionStatus) {
  if (connection === "connecting" || connection === "reconnecting") {
    return connection;
  }
  if (!snapshot) {
    return connection === "offline" ? "offline" : "idle";
  }
  return snapshot.status;
}

function formatCompactNumber(value: number) {
  if (value >= 1024 * 1024) {
    return `${(value / 1024 / 1024).toFixed(1)}m`;
  }
  if (value >= 1024) {
    return `${(value / 1024).toFixed(1)}k`;
  }
  return String(Math.round(value));
}

function formatMs(value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    return "0ms";
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)}ms`;
}

function terminalMetricsLabel(metrics: TerminalClientMetrics, snapshot: TerminalSnapshot | null) {
  const averageWriteMs = metrics.outputFrames > 0 ? metrics.outputWriteMs / metrics.outputFrames : 0;
  const serverQueue = snapshot?.stats.modelPendingWrites ?? 0;
  return `${metrics.transport} | ${metrics.renderer} | rx ${formatCompactNumber(metrics.outputChars)} | write ${formatMs(averageWriteMs)} | q ${serverQueue}`;
}

function terminalMetricsTitle(metrics: TerminalClientMetrics, snapshot: TerminalSnapshot | null) {
  const stats = snapshot?.stats;
  const averageWriteMs = metrics.outputFrames > 0 ? metrics.outputWriteMs / metrics.outputFrames : 0;
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
    `server output paused: ${stats?.outputPaused ? "yes" : "no"}`
  ].join("\n");
}

export function TerminalDock({ visible, theme, onClose }: TerminalDockProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const startSessionRef = useRef<(() => Promise<void>) | null>(null);
  const inputFlushRef = useRef<(() => void) | null>(null);
  const [snapshot, setSnapshot] = useState<TerminalSnapshot | null>(null);
  const [connection, setConnection] = useState<ConnectionStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<TerminalClientMetrics>(initialTerminalClientMetrics);
  const themeOptions = useMemo(() => terminalTheme(theme), [theme]);
  const canStop = snapshot?.status === "running" || snapshot?.status === "starting";
  const label = statusLabel(snapshot, connection);
  const metricsLabel = terminalMetricsLabel(metrics, snapshot);
  const metricsTitle = terminalMetricsTitle(metrics, snapshot);
  const startActionLabel = canStop ? "Reconnect terminal" : "Start terminal";

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
    let source: EventSource | null = null;
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
    let clientMetrics: TerminalClientMetrics = { ...initialTerminalClientMetrics };

    const terminal = new XTerm({
      cursorBlink: true,
      cursorInactiveStyle: "outline",
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
      fontSize: 12,
      lineHeight: 1.18,
      letterSpacing: 0,
      scrollback: 2_000,
      smoothScrollDuration: 0,
      theme: themeOptions,
      allowTransparency: false
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
            setError(inputError instanceof Error ? inputError.message : "Failed to write terminal input");
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
        rows: terminal.rows
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

    function handleTerminalMessage(data: string) {
      try {
        const event = JSON.parse(data) as TerminalEvent;
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

    function handleTerminalEvent(rawEvent: Event) {
      const message = rawEvent as MessageEvent<string>;
      handleTerminalMessage(message.data);
    }

    function scheduleReconnect() {
      if (disposed) {
        return;
      }
      clientMetrics.reconnects += 1;
      setConnection("offline");
      reconnectTimer = setTimeout(() => connect(lastSequence), reconnectDelayMs);
    }

    function closeTransports() {
      source?.close();
      source = null;
    }

    function connectSse(afterSequence: number) {
      source?.close();
      source = new EventSource(apiUrl(`/api/terminal/events?after=${afterSequence}`));
      source.addEventListener("terminal.output", handleTerminalEvent);
      source.addEventListener("terminal.status", handleTerminalEvent);
      source.onopen = () => {
        if (!disposed) {
          clientMetrics.transport = "sse";
          commitMetrics();
          setConnection("connected");
          setError(null);
        }
      };
      source.onerror = () => {
        source?.close();
        source = null;
        scheduleReconnect();
      };
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
          setError(startError instanceof Error ? startError.message : "Failed to start terminal");
        }
      }
    }

    const dataDisposable = terminal.onData(queueInput);
    const binaryDisposable = terminal.onBinary(queueInput);
    const resizeObserver = new ResizeObserver(scheduleResize);
    resizeObserver.observe(containerRef.current);
    startSessionRef.current = startOrAttach;

    window.requestAnimationFrame(() => {
      if (!disposed) {
        void startOrAttach();
      }
    });

    return () => {
      disposed = true;
      startSessionRef.current = null;
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
    void startSessionRef.current?.();
  }, []);

  const stopTerminal = useCallback(() => {
    inputFlushRef.current?.();
    void terminateTerminal()
      .then((nextSnapshot) => {
        setSnapshot(nextSnapshot);
        setError(null);
      })
      .catch((stopError: unknown) => {
        setError(stopError instanceof Error ? stopError.message : "Failed to stop terminal");
      });
  }, []);

  if (!visible) {
    return null;
  }

  return (
    <section className="shrink-0 border-t border-border bg-surface shadow-popover" aria-label="Terminal">
      <div className="flex h-11 items-center justify-between gap-3 border-b border-border-soft px-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-chip text-chip-fg">
            <TerminalIcon size={15} />
          </span>
          <strong className="shrink-0 text-sm font-semibold text-fg-strong">Terminal</strong>
          <span className={cn("rounded-full px-2 py-1 text-[11px] font-semibold leading-none", terminalStatusClass[label] ?? terminalStatusClass.idle)}>{label}</span>
          {snapshot ? <small className="min-w-0 truncate font-mono text-[11px] text-muted">{snapshot.command}</small> : null}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button className={iconButtonClass} type="button" title={startActionLabel} aria-label={startActionLabel} onClick={startOrAttach}>
            {canStop ? <RotateCw size={15} /> : <Play size={15} />}
          </button>
          <button
            type="button"
            className={iconButtonClass}
            title="Stop terminal process"
            aria-label="Stop terminal process"
            disabled={!canStop}
            onClick={stopTerminal}
          >
            <Square size={15} />
          </button>
          <button className={iconButtonClass} type="button" title="Hide terminal" aria-label="Hide terminal" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
      </div>
      <div className="flex h-8 min-w-0 items-center gap-2 overflow-hidden border-b border-border-soft px-3 text-[11px] text-muted">
        <span className="min-w-0 flex-1 truncate font-mono">{snapshot?.cwd ?? ""}</span>
        {snapshot?.pid ? <span className={pillClass}>pid {snapshot.pid}</span> : null}
        <span className={cn(pillClass, "hidden max-w-[42vw] truncate font-mono lg:inline-flex")} title={metricsTitle}>{metricsLabel}</span>
        {error ? <span className="max-w-[34vw] truncate rounded-full bg-error px-2 py-1 font-medium text-error-fg">{error}</span> : null}
      </div>
      <div className="h-[min(32dvh,320px)] min-h-[160px] bg-[#09090a] p-2 [&_.xterm]:h-full [&_.xterm-screen]:will-change-transform [&_.xterm-viewport]:!bg-transparent" ref={containerRef} />
    </section>
  );
}
