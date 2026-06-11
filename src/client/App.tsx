import {
  Check,
  CircleHelp,
  CircleStop,
  GitFork,
  Loader2,
  Play,
  Plus,
  RefreshCw,
  Send,
  ShieldCheck,
  Square,
  Target,
  X
} from "lucide-react";
import type { FormEvent, KeyboardEvent } from "react";
import { useEffect, useMemo, useState } from "react";
import {
  apiUrl,
  clearGoal,
  createTask,
  forkThread,
  getState,
  getThread,
  interruptTurn,
  resolveApproval,
  setGoal,
  startTurn,
  steerTurn
} from "./api.js";
import type {
  Approval,
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
    approvals: [],
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

function ApprovalList({
  approvals,
  onResolve
}: {
  approvals: Approval[];
  onResolve: (approval: Approval, approved: boolean) => void;
}) {
  if (approvals.length === 0) {
    return <div className="empty-state compact">No pending approvals</div>;
  }
  return (
    <div className="approval-list">
      {approvals.map((approval) => (
        <article className="approval-row" key={approval.id}>
          <div>
            <span className="approval-kind">{approval.kind}</span>
            <p>{approval.summary}</p>
          </div>
          <div className="approval-actions">
            <button title="Approve" onClick={() => onResolve(approval, true)}>
              <Check size={16} />
            </button>
            <button title="Deny" onClick={() => onResolve(approval, false)}>
              <X size={16} />
            </button>
          </div>
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
  const [goal, setGoalText] = useState("");
  const [showHelp, setShowHelp] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh(nextThreadId = selectedThreadId) {
    const next = await getState();
    setState(next);
    if (!selectedProjectId && next.projects[0]) {
      setSelectedProjectId(next.projects[0].id);
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
    let lastEventId = 0;
    const source = new EventSource(apiUrl("/api/events"));
    source.onmessage = () => {
      void refresh();
    };
    source.addEventListener("item.created", (event) => {
      lastEventId = Number((event as MessageEvent).lastEventId || lastEventId);
      void refresh();
    });
    source.addEventListener("item.delta", (event) => {
      lastEventId = Number((event as MessageEvent).lastEventId || lastEventId);
      void refresh();
    });
    source.addEventListener("turn.status", () => void refresh());
    source.addEventListener("approval.requested", () => void refresh());
    source.addEventListener("approval.resolved", () => void refresh());
    source.addEventListener("thread.started", () => void refresh());
    source.addEventListener("thread.forked", () => void refresh());
    source.onerror = () => {
      source.close();
      setTimeout(() => {
        void refresh();
      }, 1200);
    };
    return () => source.close();
  }, [selectedThreadId]);

  useEffect(() => {
    if (detail?.goalObjective) {
      setGoalText(detail.goalObjective);
    }
  }, [detail?.goalObjective]);

  const selectedThread = useMemo(
    () => state.threads.find((thread) => thread.id === selectedThreadId) ?? null,
    [selectedThreadId, state.threads]
  );

  const activeThreads = state.threads.filter(
    (thread) => thread.status === "running" || thread.status === "waiting_approval"
  );
  const otherThreads = state.threads.filter(
    (thread) => thread.status !== "running" && thread.status !== "waiting_approval"
  );
  const canSubmitPrompt = Boolean(prompt.trim()) && !busy && Boolean(selectedThread ? selectedThreadId : selectedProjectId);

  async function runAction(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      await refresh();
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
    setPrompt("");

    if (selectedThread && selectedThreadId) {
      void runAction(() => startTurn(selectedThreadId, currentPrompt));
      return;
    }

    if (selectedProjectId) {
      void runAction(async () => {
        const result = await createTask({ projectId: selectedProjectId, prompt: currentPrompt });
        const thread = result.thread as { id?: string } | null;
        if (thread?.id) {
          setSelectedThreadId(thread.id);
        }
      });
    }
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
    if (!selectedThreadId || !steer.trim()) {
      return;
    }
    const currentSteer = steer;
    setSteer("");
    void runAction(() => steerTurn(selectedThreadId, currentSteer));
  }

  function submitGoal(event: FormEvent) {
    event.preventDefault();
    if (!selectedThreadId || !goal.trim()) {
      return;
    }
    void runAction(() => setGoal(selectedThreadId, goal));
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
            onSelect={setSelectedProjectId}
          />
        </section>
        <section>
          <h2>Queue</h2>
          <div className="metric-row">
            <span>Tasks</span>
            <strong>{state.tasks.length}</strong>
          </div>
          <div className="metric-row">
            <span>Approvals</span>
            <strong>{state.approvals.length}</strong>
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

        <form className="task-form" onSubmit={submitPrompt}>
          <textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={handlePromptKeyDown}
            placeholder={selectedThread ? "Send next turn" : "Create a task"}
          />
          <button
            disabled={!canSubmitPrompt}
            title={selectedThread ? "Start turn (Cmd+Enter)" : "Create task (Cmd+Enter)"}
          >
            {selectedThread ? <Send size={16} /> : <Plus size={16} />}
          </button>
        </form>

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
            <button
              title="Clear goal"
              disabled={!selectedThreadId || !detail?.goalObjective}
              onClick={() => selectedThreadId && void runAction(() => clearGoal(selectedThreadId))}
            >
              <CircleStop size={16} />
            </button>
          </div>
        </div>

        <Transcript detail={detail} />
      </section>

      <aside className="inspector panel">
        <section>
          <h2>Goal</h2>
          <form className="inline-form" onSubmit={submitGoal}>
            <input
              value={goal}
              onChange={(event) => setGoalText(event.target.value)}
              placeholder="Objective"
              disabled={!selectedThreadId}
            />
            <button title="Set goal" disabled={!selectedThreadId || !goal.trim()}>
              <Target size={16} />
            </button>
          </form>
          {detail?.goalStatus ? <span className="pill">{statusLabel(detail.goalStatus)}</span> : null}
        </section>

        <section>
          <h2>Steer</h2>
          <form className="inline-form" onSubmit={submitSteer}>
            <input
              value={steer}
              onChange={(event) => setSteer(event.target.value)}
              placeholder="Steer active turn"
              disabled={!selectedThreadId || selectedThread?.status !== "running"}
            />
            <button title="Steer" disabled={!selectedThreadId || !steer.trim()}>
              <Send size={16} />
            </button>
          </form>
        </section>

        <section>
          <h2>Approvals</h2>
          <div className="approval-heading">
            <ShieldCheck size={16} />
            <span>{state.approvals.length} pending</span>
          </div>
          <ApprovalList
            approvals={state.approvals}
            onResolve={(approval, approved) => void runAction(() => resolveApproval(approval, approved))}
          />
        </section>
      </aside>
    </main>
  );
}
