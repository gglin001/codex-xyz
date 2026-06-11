import {
  CircleHelp,
  FolderOpen,
  GitFork,
  Loader2,
  Play,
  Plus,
  RefreshCw,
  Send,
  Square,
  Target
} from "lucide-react";
import type { FormEvent, KeyboardEvent } from "react";
import { useEffect, useMemo, useState } from "react";
import {
  apiUrl,
  clearGoal,
  createProject,
  createTask,
  forkThread,
  getState,
  getThread,
  interruptTurn,
  setGoal,
  startTurn,
  steerTurn
} from "./api.js";
import type {
  ControlThread,
  DashboardState,
  Project,
  ThreadDetail,
  ThreadItem
} from "../server/domain.js";

function statusLabel(status: string) {
  return status.replace("_", " ");
}

function initialState(): DashboardState {
  return {
    projects: [],
    tasks: [],
    threads: [],
    recipes: []
  };
}

function itemTitle(item: ThreadItem) {
  if (item.type === "agent") {
    return "Codex";
  }
  if (item.type === "user") {
    return "User";
  }
  return item.type;
}

type GoalPromptCommand =
  | { type: "set"; objective: string }
  | { type: "clear" }
  | { type: "usage" };

function parseGoalPromptCommand(value: string): GoalPromptCommand | null {
  const match = value.trim().match(/^\/goal(?:\s+([\s\S]*))?$/i);
  if (!match) {
    return null;
  }
  const argument = (match[1] ?? "").trim();
  if (!argument) {
    return { type: "usage" };
  }
  if (argument.toLowerCase() === "clear") {
    return { type: "clear" };
  }
  return { type: "set", objective: argument };
}

function SessionRow({
  thread,
  selected,
  onSelect
}: {
  thread: ControlThread;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button className={`session-row ${selected ? "selected" : ""}`} onClick={onSelect}>
      <span className={`status-dot ${thread.status}`} />
      <span className="session-copy">
        <strong>{thread.title}</strong>
        <small>{thread.cwd}</small>
      </span>
      <span className="session-status">{statusLabel(thread.status)}</span>
    </button>
  );
}

function ProjectList({
  projects,
  selectedProjectId,
  onSelect
}: {
  projects: Project[];
  selectedProjectId: string | null;
  onSelect: (projectId: string) => void;
}) {
  return (
    <div className="project-list">
      {projects.map((project) => (
        <button
          className={`project-row ${project.id === selectedProjectId ? "selected" : ""}`}
          key={project.id}
          onClick={() => onSelect(project.id)}
        >
          <span>{project.name}</span>
          <small>{project.path}</small>
        </button>
      ))}
    </div>
  );
}

function WorkdirField({
  projects,
  value,
  matchingProject,
  disabled,
  onChange
}: {
  projects: Project[];
  value: string;
  matchingProject: Project | null;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
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
        {trimmedValue.length === 0 ? "Required for new sessions" : matchingProject ? matchingProject.name : "New project"}
      </span>
    </div>
  );
}

function Transcript({ detail }: { detail: ThreadDetail | null }) {
  if (!detail) {
    return <div className="empty-state">No session selected</div>;
  }
  if (detail.items.length === 0) {
    return <div className="empty-state">No transcript items yet</div>;
  }
  return (
    <div className="transcript">
      {detail.items.map((item) => (
        <article className={`transcript-item ${item.type}`} key={item.id}>
          <div className="item-meta">
            <span>{itemTitle(item)}</span>
            <time>{new Date(item.createdAt).toLocaleTimeString()}</time>
          </div>
          <pre>{item.text}</pre>
        </article>
      ))}
    </div>
  );
}

function HelpPage() {
  return (
    <section className="help-page" aria-label="Keyboard shortcuts">
      <div className="help-page-header">
        <h2>Help</h2>
        <span>Keyboard shortcuts</span>
      </div>
      <div className="shortcut-row">
        <div className="shortcut-keys" aria-label="Command Enter">
          <kbd>Cmd</kbd>
          <span>+</span>
          <kbd>Enter</kbd>
        </div>
        <div>
          <strong>Execute prompt</strong>
          <p>Run the current prompt from the prompt input on macOS.</p>
        </div>
      </div>
    </section>
  );
}

export function App() {
  const [state, setState] = useState<DashboardState>(initialState);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ThreadDetail | null>(null);
  const [prompt, setPrompt] = useState("");
  const [steer, setSteer] = useState("");
  const [workdir, setWorkdir] = useState("");
  const [workdirTouched, setWorkdirTouched] = useState(false);
  const [composerMode, setComposerMode] = useState<"thread" | "new">("thread");
  const [showHelp, setShowHelp] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh(nextThreadId = selectedThreadId) {
    const next = await getState();
    setState(next);
    if (!selectedProjectId && next.projects[0]) {
      setSelectedProjectId(next.projects[0].id);
      if (!workdirTouched) {
        setWorkdir(next.projects[0].path);
      }
    }
    const preferredThreadId = nextThreadId ?? next.threads[0]?.id ?? null;
    setSelectedThreadId(preferredThreadId);
    if (preferredThreadId) {
      setDetail(await getThread(preferredThreadId));
    } else {
      setDetail(null);
    }
  }

  useEffect(() => {
    void refresh().catch((loadError: unknown) => {
      setError(loadError instanceof Error ? loadError.message : "Failed to load state");
    });
  }, []);

  useEffect(() => {
    const source = new EventSource(apiUrl("/api/events"));
    source.onmessage = () => {
      void refresh();
    };
    source.addEventListener("item.created", () => {
      void refresh();
    });
    source.addEventListener("item.delta", () => {
      void refresh();
    });
    source.addEventListener("turn.status", () => void refresh());
    source.addEventListener("thread.started", () => void refresh());
    source.addEventListener("thread.forked", () => void refresh());
    source.addEventListener("thread.goal.updated", () => void refresh());
    source.addEventListener("thread.goal.cleared", () => void refresh());
    source.onerror = () => {
      source.close();
      setTimeout(() => {
        void refresh();
      }, 1200);
    };
    return () => source.close();
  }, [selectedThreadId]);

  const selectedThread = useMemo(
    () => state.threads.find((thread) => thread.id === selectedThreadId) ?? null,
    [selectedThreadId, state.threads]
  );
  const selectedProject = useMemo(
    () => state.projects.find((project) => project.id === selectedProjectId) ?? null,
    [selectedProjectId, state.projects]
  );
  const matchingWorkdirProject = useMemo(() => {
    const trimmed = workdir.trim();
    return state.projects.find((project) => project.path === trimmed) ?? null;
  }, [state.projects, workdir]);

  const activeThreads = state.threads.filter((thread) => thread.status === "running");
  const otherThreads = state.threads.filter((thread) => thread.status !== "running");
  const promptTarget = composerMode === "thread" && selectedThread ? "thread" : "new";
  const trimmedWorkdir = workdir.trim();
  const goalPromptCommand = parseGoalPromptCommand(prompt);
  const canSubmitPrompt =
    Boolean(prompt.trim()) &&
    !busy &&
    (goalPromptCommand
      ? Boolean(selectedThreadId)
      : promptTarget === "thread"
        ? Boolean(selectedThreadId)
        : Boolean(trimmedWorkdir));
  const canSubmitSteer =
    Boolean(selectedThreadId) && selectedThread?.status === "running" && Boolean(steer.trim()) && !busy;

  useEffect(() => {
    if (!workdirTouched && selectedProject) {
      setWorkdir(selectedProject.path);
    }
  }, [selectedProject, workdirTouched]);

  function selectProject(projectId: string) {
    setSelectedProjectId(projectId);
    const project = state.projects.find((candidate) => candidate.id === projectId);
    if (project) {
      setWorkdir(project.path);
      setWorkdirTouched(false);
    }
  }

  function updateWorkdir(value: string) {
    setWorkdir(value);
    setWorkdirTouched(true);
    const project = state.projects.find((candidate) => candidate.path === value.trim());
    if (project) {
      setSelectedProjectId(project.id);
    }
  }

  async function runAction(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      const nextThreadId = await action();
      await refresh(typeof nextThreadId === "string" ? nextThreadId : selectedThreadId);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }

  function executePrompt() {
    if (!canSubmitPrompt) {
      return;
    }
    const currentPrompt = prompt;

    const goalCommand = parseGoalPromptCommand(currentPrompt);
    if (goalCommand) {
      if (!selectedThreadId) {
        setError("Select a session before using /goal.");
        return;
      }
      if (goalCommand.type === "usage") {
        setError("Use /goal <objective> or /goal clear.");
        return;
      }
      const threadId = selectedThreadId;
      setPrompt("");
      setComposerMode("thread");
      void runAction(async () => {
        if (goalCommand.type === "clear") {
          await clearGoal(threadId);
        } else {
          await setGoal(threadId, goalCommand.objective);
        }
        return threadId;
      });
      return;
    }

    setPrompt("");

    if (promptTarget === "thread" && selectedThreadId) {
      void runAction(async () => {
        const turn = await startTurn(selectedThreadId, currentPrompt);
        return turn.threadId;
      });
      return;
    }

    void runAction(async () => {
      let project = matchingWorkdirProject;
      if (!project) {
        project = await createProject({ path: trimmedWorkdir });
      }
      setSelectedProjectId(project.id);
      setWorkdir(project.path);
      setWorkdirTouched(false);
      const result = await createTask({ projectId: project.id, prompt: currentPrompt });
      const thread = result.thread as { id?: string } | null;
      setComposerMode("thread");
      return thread?.id;
    });
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

  function submitSteer(event: FormEvent) {
    event.preventDefault();
    if (!selectedThreadId || !canSubmitSteer) {
      return;
    }
    const currentSteer = steer;
    setSteer("");
    void runAction(() => steerTurn(selectedThreadId, currentSteer));
  }

  return (
    <main className="workspace">
      <aside className="sidebar panel">
        <div className="brand-row">
          <div>
            <strong>codex-xyz</strong>
            <small>Control plane</small>
          </div>
          <button title="Refresh" onClick={() => void refresh()}>
            <RefreshCw size={16} />
          </button>
        </div>
        <section>
          <h2>Projects</h2>
          <ProjectList
            projects={state.projects}
            selectedProjectId={selectedProjectId}
            onSelect={selectProject}
          />
        </section>
        <section>
          <h2>Queue</h2>
          <div className="metric-row">
            <span>Tasks</span>
            <strong>{state.tasks.length}</strong>
          </div>
        </section>
      </aside>

      <section className="sessions panel">
        <div className="panel-header">
          <div>
            <h1>Sessions</h1>
            <p>{state.threads.length} total</p>
          </div>
          <div className="panel-header-actions">
            {busy ? <Loader2 className="spin" size={18} /> : <Play size={18} />}
            <button
              className={showHelp ? "active" : ""}
              title={showHelp ? "Hide shortcuts" : "Show shortcuts"}
              aria-label={showHelp ? "Hide shortcuts" : "Show shortcuts"}
              aria-expanded={showHelp}
              onClick={() => setShowHelp((current) => !current)}
            >
              <CircleHelp size={16} />
            </button>
          </div>
        </div>

        {showHelp ? <HelpPage /> : null}

        <div className="composer-mode" role="group" aria-label="Prompt target">
          <button
            type="button"
            className={promptTarget === "new" ? "active" : ""}
            title="Create new session"
            onClick={() => setComposerMode("new")}
          >
            <Plus size={15} />
            <span>New session</span>
          </button>
          <button
            type="button"
            className={promptTarget === "thread" ? "active" : ""}
            title="Send to selected session"
            disabled={!selectedThreadId}
            onClick={() => setComposerMode("thread")}
          >
            <Send size={15} />
            <span>Selected</span>
          </button>
        </div>

        <div className="composer-stack">
          {promptTarget === "new" ? (
            <WorkdirField
              projects={state.projects}
              value={workdir}
              matchingProject={matchingWorkdirProject}
              disabled={busy}
              onChange={updateWorkdir}
            />
          ) : null}

          <form className="task-form" onSubmit={submitPrompt}>
            <textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              onKeyDown={handlePromptKeyDown}
              placeholder={promptTarget === "thread" ? "Send next turn or /goal <objective>" : "Create a task"}
            />
            <button
              disabled={!canSubmitPrompt}
              title={
                goalPromptCommand
                  ? "Apply goal command (Cmd+Enter)"
                  : promptTarget === "thread"
                    ? "Start turn (Cmd+Enter)"
                    : "Create task (Cmd+Enter)"
              }
            >
              {goalPromptCommand ? <Target size={16} /> : promptTarget === "thread" ? <Send size={16} /> : <Plus size={16} />}
            </button>
          </form>

          {selectedThread ? (
            <div className="thread-composer-extras">
              {detail?.goalObjective ? (
                <div className="goal-summary" title="Current goal">
                  <Target size={15} />
                  <span className="goal-objective">{detail.goalObjective}</span>
                  {detail.goalStatus ? <span className="goal-status">{statusLabel(detail.goalStatus)}</span> : null}
                </div>
              ) : null}
              <form className="steer-form" onSubmit={submitSteer}>
                <input
                  value={steer}
                  onChange={(event) => setSteer(event.target.value)}
                  placeholder="Steer active turn"
                  disabled={!selectedThreadId || selectedThread.status !== "running" || busy}
                  aria-label="Steer active turn"
                />
                <button title="Steer active turn" disabled={!canSubmitSteer}>
                  <Send size={16} />
                </button>
              </form>
            </div>
          ) : null}
        </div>

        {error ? <div className="error-banner">{error}</div> : null}

        <div className="session-group">
          <h2>Active</h2>
          {activeThreads.length === 0 ? <div className="empty-state compact">No active sessions</div> : null}
          {activeThreads.map((thread) => (
            <SessionRow
              key={thread.id}
              thread={thread}
              selected={thread.id === selectedThreadId}
              onSelect={() => {
                setSelectedThreadId(thread.id);
                setComposerMode("thread");
                void getThread(thread.id).then(setDetail);
              }}
            />
          ))}
        </div>

        <div className="session-group">
          <h2>History</h2>
          {otherThreads.map((thread) => (
            <SessionRow
              key={thread.id}
              thread={thread}
              selected={thread.id === selectedThreadId}
              onSelect={() => {
                setSelectedThreadId(thread.id);
                setComposerMode("thread");
                void getThread(thread.id).then(setDetail);
              }}
            />
          ))}
        </div>
      </section>

      <section className="detail panel">
        <div className="panel-header detail-header">
          <div>
            <h1>{selectedThread?.title ?? "Session"}</h1>
            <p>{selectedThread ? statusLabel(selectedThread.status) : "idle"}</p>
          </div>
          <div className="toolbar">
            <button
              title="Interrupt"
              disabled={!selectedThreadId || selectedThread?.status !== "running"}
              onClick={() => selectedThreadId && void runAction(() => interruptTurn(selectedThreadId))}
            >
              <Square size={16} />
            </button>
            <button
              title="Fork"
              disabled={!selectedThreadId}
              onClick={() => selectedThreadId && void runAction(() => forkThread(selectedThreadId))}
            >
              <GitFork size={16} />
            </button>
          </div>
        </div>

        <Transcript detail={detail} />
      </section>
    </main>
  );
}
