import { FolderOpen, Plus, Send, Square, Target } from "lucide-react";
import type { FormEvent, KeyboardEvent, PointerEvent } from "react";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import type { ControlThread } from "../../server/domain.js";
import { activeIconButtonClass, cn } from "../classNames.js";
import type { ComposerMode } from "./types.js";
import { StatusBanners } from "./StatusBanners.js";

type WorkdirFieldProps = {
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
};

export type PromptComposerProps = {
  className?: string;
  showStatus?: boolean;
  compact?: boolean;
  collapsible?: boolean;
  workdir: string;
  busy: boolean;
  busyAction: string | null;
  notice: string | null;
  error: string | null;
  prompt: string;
  promptTarget: ComposerMode;
  goalMode: boolean;
  selectedThreadId: string | null;
  canUseGoalMode: boolean;
  canSubmitPrompt: boolean;
  onModeChange: (mode: ComposerMode) => void;
  onWorkdirChange: (value: string) => void;
  onPromptChange: (value: string) => void;
  onPromptKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onPromptSubmit: (event: FormEvent) => void;
  onGoalModeChange: (value: boolean) => void;
  selectedThread: ControlThread | null;
  onInterrupt: () => void;
  onResume: () => void;
};

type PromptResizeState = {
  startY: number;
  startHeight: number;
  minHeight: number;
  maxHeight: number;
};

const compactPromptMinHeight = 38;
const defaultPromptMinHeight = 88;
const toolbarButtonClass =
  "inline-flex h-8 min-w-8 items-center justify-center rounded-md border border-border-soft bg-control/35 text-muted-strong shadow-control transition duration-200 ease-snappy hover:border-border hover:bg-control-hover hover:text-fg-strong disabled:cursor-not-allowed disabled:opacity-35"

function getViewportHeight() {
  return window.visualViewport?.height || window.innerHeight || document.documentElement.clientHeight || 720;
}

function getPromptLayoutMaxHeight(textarea: HTMLTextAreaElement, viewportMaxHeight: number) {
  const composer = textarea.closest<HTMLElement>(".prompt-composer");
  const composerStyle = composer ? window.getComputedStyle(composer) : null;
  const composerMaxHeight = composerStyle ? Number.parseFloat(composerStyle.maxHeight) : Number.NaN;
  if (!composer || !Number.isFinite(composerMaxHeight)) {
    return viewportMaxHeight;
  }

  const availableComposerGrowth = Math.max(0, composerMaxHeight - composer.getBoundingClientRect().height);
  return textarea.getBoundingClientRect().height + availableComposerGrowth;
}

const WorkdirField = memo(function WorkdirField({ value, disabled, onChange }: WorkdirFieldProps) {
  return (
    <div className="rounded-lg border border-border-soft bg-surface-subtle/70 p-1 shadow-control">
      <label className="flex h-9 items-center gap-2 rounded-md px-2 text-muted transition duration-200 ease-snappy focus-within:bg-field focus-within:text-muted-strong">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-chip text-chip-fg shadow-control">
          <FolderOpen size={14} />
        </span>
        <input
          className="min-w-0 flex-1 border-0 bg-transparent font-mono text-[12px] text-fg-strong placeholder:text-muted focus:outline-none disabled:opacity-60"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="/path/to/repo"
          disabled={disabled}
          aria-label="Working directory"
        />
      </label>
    </div>
  );
});

export const PromptComposer = memo(function PromptComposer({
  className,
  showStatus = false,
  compact = false,
  collapsible = false,
  workdir,
  busy,
  busyAction,
  notice,
  error,
  prompt,
  promptTarget,
  goalMode,
  selectedThreadId,
  canUseGoalMode,
  canSubmitPrompt,
  selectedThread,
  onModeChange,
  onWorkdirChange,
  onPromptChange,
  onPromptKeyDown,
  onPromptSubmit,
  onGoalModeChange,
  onInterrupt,
  onResume
}: PromptComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const resizeStateRef = useRef<PromptResizeState | null>(null);
  const focusOnExpandRef = useRef(false);
  const [promptHeight, setPromptHeight] = useState<number | null>(null);
  const [expanded, setExpanded] = useState(!collapsible);
  const promptPlaceholder = goalMode
    ? "Describe the goal objective"
    : promptTarget === "thread"
      ? "Send prompt"
      : "Create session";
  const submitTitle = goalMode ? "Start goal mode" : promptTarget === "thread" ? "Send prompt" : "Create session";
  const goalModeTitle = canUseGoalMode
    ? "Use the prompt as the goal objective"
    : promptTarget === "thread"
      ? "Goal mode requires an idle selected session"
      : "Goal mode requires a working directory";
  const newModeTitle = promptTarget === "new" && selectedThreadId ? "Use selected session" : "New session";
  const PromptIcon = goalMode ? Target : promptTarget === "thread" ? Send : Plus;
  const hasPrompt = prompt.trim().length > 0;
  const hasStatus = Boolean(busy || busyAction || notice || error);
  const isExpanded = !collapsible || expanded || hasPrompt || hasStatus;
  const hasSelectedThread = Boolean(selectedThreadId);
  const canInterrupt = selectedThread?.status === "running" && !busy;
  const canResume = hasSelectedThread && selectedThread?.status !== "running" && !busy;
  const classes = [
    "prompt-composer",
    className,
    "grid gap-2",
    collapsible ? "collapsible" : null,
    isExpanded ? "expanded" : "collapsed"
  ]
    .filter(Boolean)
    .join(" ");
  const handleNewModeClick = useCallback(() => {
    if (promptTarget === "new" && selectedThreadId) {
      onModeChange("thread");
      return;
    }
    onModeChange("new");
  }, [onModeChange, promptTarget, selectedThreadId]);
  const expandComposer = useCallback(() => {
    focusOnExpandRef.current = true;
    setExpanded(true);
  }, []);

  useEffect(() => {
    if (!collapsible) {
      setExpanded(true);
    }
  }, [collapsible]);

  useEffect(() => {
    if (!isExpanded || !focusOnExpandRef.current) {
      return;
    }
    focusOnExpandRef.current = false;
    window.requestAnimationFrame(() => {
      textareaRef.current?.focus({ preventScroll: true });
    });
  }, [isExpanded]);

  useEffect(() => {
    const handlePointerMove = (event: globalThis.PointerEvent) => {
      const resizeState = resizeStateRef.current;
      if (!resizeState) {
        return;
      }
      event.preventDefault();
      const delta = resizeState.startY - event.clientY;
      const nextHeight = Math.min(
        resizeState.maxHeight,
        Math.max(resizeState.minHeight, resizeState.startHeight + delta)
      );
      setPromptHeight(nextHeight);
    };
    const handlePointerUp = () => {
      resizeStateRef.current = null;
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
    };
  }, []);

  const handlePromptResizePointerDown = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      const textarea = textareaRef.current;
      if (!textarea || busy) {
        return;
      }
      event.preventDefault();
      const viewportHeight = getViewportHeight();
      const minHeight = compact ? compactPromptMinHeight : defaultPromptMinHeight;
      const viewportMaxHeight = Math.floor(viewportHeight * (compact ? 0.34 : 0.44));
      const layoutMaxHeight = getPromptLayoutMaxHeight(textarea, viewportMaxHeight);
      const maxHeight = Math.max(minHeight, Math.min(viewportMaxHeight, Math.floor(layoutMaxHeight)));
      resizeStateRef.current = {
        startY: event.clientY,
        startHeight: textarea.getBoundingClientRect().height,
        minHeight,
        maxHeight
      };
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [busy, compact]
  );
  const collapseAfterSubmit = useCallback(() => {
    if (!collapsible) {
      return;
    }
    focusOnExpandRef.current = false;
    setPromptHeight(null);
    setExpanded(false);
  }, [collapsible]);
  const handleSubmit = useCallback(
    (event: FormEvent) => {
      const shouldCollapse = collapsible && canSubmitPrompt;
      onPromptSubmit(event);
      if (shouldCollapse) {
        collapseAfterSubmit();
      }
    },
    [canSubmitPrompt, collapseAfterSubmit, collapsible, onPromptSubmit]
  );
  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      const shouldCollapse =
        collapsible && canSubmitPrompt && event.key === "Enter" && event.metaKey && !event.nativeEvent.isComposing;
      onPromptKeyDown(event);
      if (shouldCollapse) {
        collapseAfterSubmit();
      }
    },
    [canSubmitPrompt, collapseAfterSubmit, collapsible, onPromptKeyDown]
  );

  return (
    <div className={classes}>
      {showStatus && isExpanded ? <StatusBanners busyAction={busyAction} notice={notice} error={error} /> : null}

      {!isExpanded ? (
        <button
          type="button"
          className="flex h-11 w-full items-center gap-2 rounded-lg border border-border-soft bg-surface px-3 text-left text-sm font-medium text-muted-strong shadow-control transition duration-200 ease-snappy hover:border-border hover:bg-control-hover hover:text-fg-strong"
          title={promptPlaceholder}
          aria-label={promptPlaceholder}
          onClick={expandComposer}
        >
          <PromptIcon size={16} />
          <span className="min-w-0 truncate">{promptPlaceholder}</span>
        </button>
      ) : null}

      {isExpanded ? (
        <div className="grid gap-2">
          {promptTarget === "new" ? <WorkdirField value={workdir} disabled={busy} onChange={onWorkdirChange} /> : null}

          <form onSubmit={handleSubmit}>
            <div className="relative overflow-hidden rounded-lg border border-border bg-surface shadow-panel transition duration-200 ease-snappy focus-within:border-border-strong focus-within:ring-2 focus-within:ring-focus-ring/60">
              <div
                className="absolute inset-x-0 top-0 z-10 flex h-3 cursor-ns-resize items-start justify-center"
                role="separator"
                aria-label="Resize prompt input"
                aria-orientation="horizontal"
                title="Drag up to resize prompt input"
                onPointerDown={handlePromptResizePointerDown}
              >
                <span className="mt-1 h-0.5 w-10 rounded-full bg-border-strong opacity-70 transition group-hover:bg-muted" />
              </div>
              <textarea
                ref={textareaRef}
                className={cn(
                  "block w-full resize-none border-0 bg-transparent px-3 pb-2 pt-4 text-sm leading-6 text-fg-strong placeholder:text-muted focus:outline-none disabled:opacity-60",
                  compact
                    ? "min-h-[38px] max-h-[var(--mobile-textarea-max-height)]"
                    : "min-h-[88px] max-h-[38dvh]"
                )}
                value={prompt}
                onChange={(event) => onPromptChange(event.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={promptPlaceholder}
                disabled={busy}
                style={promptHeight === null ? undefined : { height: `${promptHeight}px` }}
              />
              <div className="flex items-center justify-between gap-2 border-t border-border-soft bg-surface-subtle px-2 py-2">
                <div className="flex min-w-0 items-center gap-2">
                  <div className="flex rounded-md border border-border-soft bg-surface p-0.5" role="group" aria-label="Session mode">
                    <button
                      type="button"
                      className={cn(
                        "inline-flex h-7 min-w-7 items-center justify-center rounded text-muted-strong transition duration-200 ease-snappy hover:bg-control-hover hover:text-fg-strong",
                        promptTarget === "new" ? "bg-control-hover text-fg-strong" : null
                      )}
                      title={newModeTitle}
                      aria-label={newModeTitle}
                      aria-pressed={promptTarget === "new"}
                      onClick={handleNewModeClick}
                    >
                      <Plus size={15} />
                    </button>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      className={cn(toolbarButtonClass, goalMode ? activeIconButtonClass : null)}
                      title={goalModeTitle}
                      aria-label={goalModeTitle}
                      aria-pressed={goalMode}
                      disabled={!canUseGoalMode || busy}
                      onClick={() => onGoalModeChange(!goalMode)}
                    >
                      <Target size={15} />
                    </button>
                    <button
                      type="button"
                      className={toolbarButtonClass}
                      title="Interrupt"
                      aria-label="Interrupt"
                      disabled={!canInterrupt}
                      onClick={onInterrupt}
                    >
                      <Square size={15} />
                    </button>
                    <button
                      type="button"
                      className={toolbarButtonClass}
                      title="Resume"
                      aria-label="Resume"
                      disabled={!canResume}
                      onClick={onResume}
                    >
                      <Send size={15} />
                    </button>
                  </div>
                </div>
                <button
                  className={cn(
                    "inline-flex h-8 min-w-8 items-center justify-center rounded-md border border-transparent bg-accent px-2 text-accent-fg shadow-control transition duration-200 ease-snappy hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-35 active:scale-[0.98]",
                    canSubmitPrompt ? "shadow-control" : null
                  )}
                  disabled={!canSubmitPrompt}
                  title={submitTitle}
                  aria-label={submitTitle}
                >
                  <PromptIcon size={16} />
                </button>
              </div>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
});
