import { FolderOpen, Plus, Send, Square, Target } from "lucide-react";
import type { FormEvent, KeyboardEvent, PointerEvent } from "react";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import type { ControlThread } from "../../server/domain.js";
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
const defaultPromptMinHeight = 124;

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
    <div className="workdir-panel">
      <label className="workdir-field">
        <span className="field-label">
          <FolderOpen size={14} />
        </span>
        <input
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
          className="prompt-collapsed-trigger"
          title={promptPlaceholder}
          aria-label={promptPlaceholder}
          onClick={expandComposer}
        >
          <PromptIcon size={16} />
          <span>{promptPlaceholder}</span>
        </button>
      ) : null}

      {isExpanded ? (
        <div className="composer-stack">
          {promptTarget === "new" ? <WorkdirField value={workdir} disabled={busy} onChange={onWorkdirChange} /> : null}

          <form className="task-form" onSubmit={handleSubmit}>
            <div className="prompt-shell">
              <div
                className="prompt-resize-handle"
                role="separator"
                aria-label="Resize prompt input"
                aria-orientation="horizontal"
                title="Drag up to resize prompt input"
                onPointerDown={handlePromptResizePointerDown}
              />
              <textarea
                ref={textareaRef}
                value={prompt}
                onChange={(event) => onPromptChange(event.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={promptPlaceholder}
                disabled={busy}
                style={promptHeight === null ? undefined : { height: `${promptHeight}px` }}
              />
              <div className="prompt-toolbar">
                <div className="prompt-toolbar-left">
                  <div className="composer-mode" role="group" aria-label="Session mode">
                    <button
                      type="button"
                      className={promptTarget === "new" ? "active" : ""}
                      title={newModeTitle}
                      aria-label={newModeTitle}
                      aria-pressed={promptTarget === "new"}
                      onClick={handleNewModeClick}
                    >
                      <Plus size={15} />
                    </button>
                  </div>
                  <div className="prompt-options">
                    <button
                      type="button"
                      className={`prompt-option ${goalMode ? "active" : ""} ${!canUseGoalMode || busy ? "disabled" : ""}`}
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
                      className="prompt-option"
                      title="Interrupt"
                      aria-label="Interrupt"
                      disabled={!canInterrupt}
                      onClick={onInterrupt}
                    >
                      <Square size={15} />
                    </button>
                    <button
                      type="button"
                      className="prompt-option"
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
                  className="prompt-submit"
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
