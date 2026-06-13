import { FolderOpen, Plus, Route, Send, Target } from "lucide-react";
import type { FormEvent, KeyboardEvent, PointerEvent } from "react";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import type { Project } from "../../server/domain.js";
import type { ComposerMode } from "./types.js";
import { StatusBanners } from "./StatusBanners.js";

type WorkdirFieldProps = {
  projects: Project[];
  value: string;
  matchingProject: Project | null;
  disabled: boolean;
  onChange: (value: string) => void;
};

export type PromptComposerProps = {
  className?: string;
  showStatus?: boolean;
  compact?: boolean;
  projects: Project[];
  workdir: string;
  matchingProject: Project | null;
  busy: boolean;
  busyAction: string | null;
  notice: string | null;
  error: string | null;
  prompt: string;
  promptTarget: ComposerMode;
  goalMode: boolean;
  selectedThreadId: string | null;
  steerMode: boolean;
  canUseSteerMode: boolean;
  canUseGoalMode: boolean;
  canSubmitPrompt: boolean;
  onModeChange: (mode: ComposerMode) => void;
  onWorkdirChange: (value: string) => void;
  onPromptChange: (value: string) => void;
  onPromptKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onPromptSubmit: (event: FormEvent) => void;
  onSteerModeChange: (value: boolean) => void;
  onGoalModeChange: (value: boolean) => void;
};

type PromptResizeState = {
  startY: number;
  startHeight: number;
  minHeight: number;
  maxHeight: number;
};

const WorkdirField = memo(function WorkdirField({
  projects,
  value,
  disabled,
  onChange
}: WorkdirFieldProps) {

  return (
    <div className="workdir-panel">
      <label className="workdir-field">
        <span className="field-label">
          <FolderOpen size={14} />
        </span>
        <input
          value={value}
          list="project-workdirs"
          onChange={(event) => onChange(event.target.value)}
          placeholder="/path/to/repo"
          disabled={disabled}
          aria-label="Working directory"
        />
      </label>
      <datalist id="project-workdirs">
        {projects.map((project) => (
          <option key={project.id} value={project.path}>
            {project.name}
          </option>
        ))}
      </datalist>
    </div>
  );
});

export const PromptComposer = memo(function PromptComposer({
  className,
  showStatus = false,
  compact = false,
  projects,
  workdir,
  matchingProject,
  busy,
  busyAction,
  notice,
  error,
  prompt,
  promptTarget,
  goalMode,
  selectedThreadId,
  steerMode,
  canUseSteerMode,
  canUseGoalMode,
  canSubmitPrompt,
  onModeChange,
  onWorkdirChange,
  onPromptChange,
  onPromptKeyDown,
  onPromptSubmit,
  onSteerModeChange,
  onGoalModeChange
}: PromptComposerProps) {
  const classes = className ? `prompt-composer ${className}` : "prompt-composer";
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const resizeStateRef = useRef<PromptResizeState | null>(null);
  const [promptHeight, setPromptHeight] = useState<number | null>(null);
  const promptPlaceholder = steerMode
    ? "Steer active turn"
    : goalMode
      ? "Describe the goal objective"
      : promptTarget === "thread"
        ? "Send next turn"
        : "Create a task";
  const submitTitle = steerMode
    ? "Steer active turn"
    : goalMode
      ? "Start goal mode"
      : promptTarget === "thread"
        ? "Start turn"
        : "Create session";
  const steerModeTitle = canUseSteerMode
    ? "Steer the active turn"
    : "Steer mode requires a running selected session";
  const goalModeTitle = canUseGoalMode
    ? "Use the prompt as the goal objective"
    : promptTarget === "thread"
      ? "Goal mode requires an idle selected session"
      : "Goal mode requires a working directory";
  const newModeTitle = promptTarget === "new" && selectedThreadId ? "Use selected session" : "New session";
  const handleNewModeClick = useCallback(() => {
    if (promptTarget === "new" && selectedThreadId) {
      onModeChange("thread");
      return;
    }
    onModeChange("new");
  }, [onModeChange, promptTarget, selectedThreadId]);

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
      const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 720;
      const minHeight = compact ? 96 : 124;
      const maxHeight = Math.max(minHeight, Math.floor(viewportHeight * (compact ? 0.34 : 0.44)));
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

  return (
    <div className={classes}>
      {showStatus ? <StatusBanners busyAction={busyAction} notice={notice} error={error} /> : null}

      <div className="composer-stack">
        {promptTarget === "new" ? (
          <WorkdirField
            projects={projects}
            value={workdir}
            matchingProject={matchingProject}
            disabled={busy}
            onChange={onWorkdirChange}
          />
        ) : null}

        <form className="task-form" onSubmit={onPromptSubmit}>
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
              onKeyDown={onPromptKeyDown}
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
                    aria-pressed={promptTarget === "new"}
                    onClick={handleNewModeClick}
                  >
                    <Plus size={15} />
                    <span>New</span>
                  </button>
                </div>
                <div className="prompt-options">
                  <label
                    className={`prompt-option ${steerMode ? "active" : ""} ${!canUseSteerMode || busy ? "disabled" : ""}`}
                    title={steerModeTitle}
                  >
                    <input
                      type="checkbox"
                      checked={steerMode}
                      disabled={!canUseSteerMode || busy}
                      onChange={(event) => onSteerModeChange(event.target.checked)}
                    />
                    <span>Steer</span>
                  </label>
                  <label
                    className={`prompt-option ${goalMode ? "active" : ""} ${!canUseGoalMode || busy ? "disabled" : ""}`}
                    title={goalModeTitle}
                  >
                    <input
                      type="checkbox"
                      checked={goalMode}
                      disabled={!canUseGoalMode || busy}
                      onChange={(event) => onGoalModeChange(event.target.checked)}
                    />
                    <span>Goal</span>
                  </label>
                </div>
              </div>
              <button className="prompt-submit" disabled={!canSubmitPrompt} title={submitTitle}>
                {steerMode ? (
                  <Route size={16} />
                ) : goalMode ? (
                  <Target size={16} />
                ) : promptTarget === "thread" ? (
                  <Send size={16} />
                ) : (
                  <Plus size={16} />
                )}
                <span>Run</span>
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
});
