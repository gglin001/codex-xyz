import { FitAddon } from "@xterm/addon-fit";
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
import type { TerminalEvent, TerminalSnapshot } from "../server/domain.js";

type TerminalDockProps = {
  visible: boolean;
  theme: "dark" | "light";
  onClose: () => void;
};

type ConnectionStatus = "idle" | "connecting" | "connected" | "reconnecting" | "offline";

const reconnectDelayMs = 1_200;
const inputFlushMs = 8;
const resizeFlushMs = 100;

function terminalTheme(mode: "dark" | "light") {
  if (mode === "light") {
    return {
      background: "#ffffff",
      foreground: "#1f2937",
      cursor: "#2c7a7b",
      selectionBackground: "#d8f3ef",
      black: "#111827",
      red: "#b42318",
      green: "#1d684f",
      yellow: "#8a5a12",
      blue: "#28577a",
      magenta: "#5b42a8",
      cyan: "#155e63",
      white: "#e5e7eb"
    };
  }
  return {
    background: "#0b111a",
    foreground: "#e6edf5",
    cursor: "#55c8bd",
    selectionBackground: "#244650",
    black: "#0f1723",
    red: "#ffb4b4",
    green: "#7ee3c1",
    yellow: "#f1c56f",
    blue: "#add7ff",
    magenta: "#ccb7ff",
    cyan: "#9df0e7",
    white: "#f8fafc"
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

export function TerminalDock({ visible, theme, onClose }: TerminalDockProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const startSessionRef = useRef<(() => Promise<void>) | null>(null);
  const inputFlushRef = useRef<(() => void) | null>(null);
  const [snapshot, setSnapshot] = useState<TerminalSnapshot | null>(null);
  const [connection, setConnection] = useState<ConnectionStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const themeOptions = useMemo(() => terminalTheme(theme), [theme]);
  const canStop = snapshot?.status === "running" || snapshot?.status === "starting";
  const label = statusLabel(snapshot, connection);

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
    let outputFrame: number | null = null;
    let pendingOutput = "";
    let outputWriteInProgress = false;
    let inputTimer: ReturnType<typeof setTimeout> | null = null;
    let inputBuffer = "";
    let inputChain: Promise<void> = Promise.resolve();
    let lastSequence = 0;

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
    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    function writeOutputNow() {
      outputFrame = null;
      if (outputWriteInProgress || pendingOutput.length === 0) {
        return;
      }
      const data = pendingOutput;
      pendingOutput = "";
      outputWriteInProgress = true;
      terminal.write(data, () => {
        outputWriteInProgress = false;
        if (pendingOutput.length > 0 && !disposed) {
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
      pendingOutput += data;
      scheduleOutputWrite();
    }

    function flushInput() {
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

    inputFlushRef.current = flushInput;

    function queueInput(data: string) {
      inputBuffer += data;
      if (inputBuffer.length >= 4096) {
        flushInput();
        return;
      }
      if (!inputTimer) {
        inputTimer = setTimeout(flushInput, inputFlushMs);
      }
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

    function handleTerminalEvent(rawEvent: Event) {
      const message = rawEvent as MessageEvent<string>;
      try {
        const event = JSON.parse(message.data) as TerminalEvent;
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

    function connect(afterSequence: number) {
      source?.close();
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      if (!disposed) {
        setConnection(afterSequence > 0 ? "reconnecting" : "connecting");
      }
      source = new EventSource(apiUrl(`/api/terminal/events?after=${afterSequence}`));
      source.addEventListener("terminal.output", handleTerminalEvent);
      source.addEventListener("terminal.status", handleTerminalEvent);
      source.onopen = () => {
        if (!disposed) {
          setConnection("connected");
          setError(null);
        }
      };
      source.onerror = () => {
        source?.close();
        source = null;
        if (!disposed) {
          setConnection("offline");
          reconnectTimer = setTimeout(() => connect(lastSequence), reconnectDelayMs);
        }
      };
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
      flushInput();
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
      }
      if (resizeTimer) {
        clearTimeout(resizeTimer);
      }
      if (inputTimer) {
        clearTimeout(inputTimer);
      }
      if (outputFrame !== null) {
        window.cancelAnimationFrame(outputFrame);
      }
      source?.close();
      resizeObserver.disconnect();
      dataDisposable.dispose();
      binaryDisposable.dispose();
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
    <section className="terminal-dock" aria-label="Terminal">
      <div className="terminal-dock-header">
        <div className="terminal-dock-title">
          <TerminalIcon size={15} />
          <strong>Terminal</strong>
          <span className={`terminal-status ${label}`}>{label}</span>
          {snapshot ? <small>{snapshot.command}</small> : null}
        </div>
        <div className="terminal-dock-actions">
          <button type="button" title="Reconnect terminal" aria-label="Reconnect terminal" onClick={startOrAttach}>
            {canStop ? <RotateCw size={15} /> : <Play size={15} />}
            <span>{canStop ? "Reconnect" : "Start"}</span>
          </button>
          <button type="button" title="Stop terminal process" disabled={!canStop} onClick={stopTerminal}>
            <Square size={15} />
            <span>Stop</span>
          </button>
          <button type="button" title="Hide terminal" aria-label="Hide terminal" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
      </div>
      <div className="terminal-dock-meta">
        <span>{snapshot?.cwd ?? ""}</span>
        {snapshot?.pid ? <span>pid {snapshot.pid}</span> : null}
        {error ? <span className="terminal-error">{error}</span> : null}
      </div>
      <div className="terminal-dock-body" ref={containerRef} />
    </section>
  );
}
