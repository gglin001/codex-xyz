import { FolderOpen, Plus, Route, Send, Target } from "lucide-react";
import type { FormEvent, KeyboardEvent } from "react";
import { memo } from "react";
import type { ControlThread, Project } from "../../server/domain.js";
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
  goalPrompt: boolean;
  selectedThread: ControlThread | null;
  selectedThreadId: string | null;
  steerMode: boolean;
  canUseSteerMode: boolean;
  canSubmitPrompt: boolean;
  onModeChange: (mode: ComposerMode) => void;
  onWorkdirChange: (value: string) => void;
  onPromptChange: (value: string) => void;
  onPromptKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onPromptSubmit: (event: FormEvent) => void;
  onSteerModeChange: (value: boolean) => void;
};

const WorkdirField = memo(function WorkdirField({
  projects,
  value,
  matchingProject,
  disabled,
  onChange
}: WorkdirFieldProps) {
  const trimmedValue = value.trim();

  return (
    <div className="workdir-panel">
      <label className="workdir-field">
        <span className="field-label">
          <FolderOpen size={14} />
          <span>Workdir</span>
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
      <span className={`workdir-state ${matchingProject ? "existing" : "new"}`}>
        {trimmedValue.length === 0 ? "Required" : matchingProject ? matchingProject.name : "New project"}
      </span>
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
  goalPrompt,
  selectedThread,
  selectedThreadId,
  steerMode,
  canUseSteerMode,
  canSubmitPrompt,
  onModeChange,
  onWorkdirChange,
  onPromptChange,
  onPromptKeyDown,
  onPromptSubmit,
  onSteerModeChange
}: PromptComposerProps) {
  const classes = className ? `prompt-composer ${className}` : "prompt-composer";
  const showPromptOptions =
    promptTarget === "thread" && Boolean(selectedThread) && (!compact || selectedThread?.status === "running");
  const promptPlaceholder = steerMode
    ? "Steer active turn"
    : promptTarget === "thread"
      ? "Send next turn or /goal <objective>"
      : "Create a task";
  const submitTitle = steerMode
    ? "Steer active turn"
    : goalPrompt
      ? "Start goal turn"
      : promptTarget === "thread"
        ? "Start turn"
        : "Create session";

  return (
    <div className={classes}>
      {showStatus ? <StatusBanners busyAction={busyAction} notice={notice} error={error} /> : null}

      <div className="composer-mode" role="group" aria-label="Prompt target">
        <button
          type="button"
          className={promptTarget === "new" ? "active" : ""}
          title="New session"
          onClick={() => onModeChange("new")}
        >
          <Plus size={15} />
          <span>New session</span>
        </button>
        <button
          type="button"
          className={promptTarget === "thread" ? "active" : ""}
          title="Selected session"
          disabled={!selectedThreadId}
          onClick={() => onModeChange("thread")}
        >
          <Send size={15} />
          <span>Selected</span>
        </button>
      </div>

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
          <div className="prompt-field-row">
            <textarea
              value={prompt}
              onChange={(event) => onPromptChange(event.target.value)}
              onKeyDown={onPromptKeyDown}
              placeholder={promptPlaceholder}
              disabled={busy}
            />
            <button disabled={!canSubmitPrompt} title={submitTitle}>
              {steerMode ? (
                <Route size={16} />
              ) : goalPrompt ? (
                <Target size={16} />
              ) : promptTarget === "thread" ? (
                <Send size={16} />
              ) : (
                <Plus size={16} />
              )}
            </button>
          </div>
          {showPromptOptions ? (
            <div className="prompt-options">
              <label className="prompt-option">
                <input
                  type="checkbox"
                  checked={steerMode}
                  disabled={!canUseSteerMode || busy}
                  onChange={(event) => onSteerModeChange(event.target.checked)}
                />
                <span>Steer mode</span>
              </label>
            </div>
          ) : null}
        </form>
      </div>
    </div>
  );
});
