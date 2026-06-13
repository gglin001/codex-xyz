import { History, Loader2, Moon, RefreshCw, Search, Sun, Target, Terminal } from "lucide-react";
import { memo } from "react";
import type { ControlThread } from "../../server/domain.js";
import { selectionTouchesThreadGroup, type SessionListModel } from "../sessionList.js";
import { formatTokens, statusLabel, statusTone } from "../uiFormat.js";
import type { ThemeMode } from "./types.js";

type SelectThreadHandler = (threadId: string) => void | Promise<void>;

type SessionGroupProps = {
  title: string;
  threads: ControlThread[];
  selectedThreadId: string | null;
  hasQuery: boolean;
  emptyLabel: string;
  emptyQueryLabel: string;
  onSelectThread: SelectThreadHandler;
};

export type SessionSidebarProps = {
  sessionCountLabel: string;
  queuedTaskCount: number;
  busy: boolean;
  theme: ThemeMode;
  nextTheme: ThemeMode;
  terminalVisible: boolean;
  sessionQuery: string;
  sessionList: SessionListModel;
  selectedThreadId: string | null;
  onTerminalToggle: () => void;
  onThemeChange: (theme: ThemeMode) => void;
  onRefresh: () => void;
  onSessionQueryChange: (value: string) => void;
  onSelectThread: SelectThreadHandler;
};

const SessionRow = memo(function SessionRow({
  thread,
  selected,
  onSelectThread
}: {
  thread: ControlThread;
  selected: boolean;
  onSelectThread: SelectThreadHandler;
}) {
  const hasGoal = Boolean(thread.goalObjective && thread.goalStatus && thread.goalStatus !== "cleared");
  const goalStatus = thread.goalStatus ? `Goal ${statusLabel(thread.goalStatus)}` : "Goal";

  return (
    <button
      className={`session-row ${selected ? "selected" : ""}`}
      onClick={() => {
        void onSelectThread(thread.id);
      }}
      aria-pressed={selected}
    >
      <span className="session-row-main">
        <span className={`status-dot ${thread.status}`} />
        <span className="session-copy">
          <strong>{thread.title}</strong>
          <small>{thread.preview || thread.cwd}</small>
        </span>
        <span className={`session-status ${statusTone(thread.status)}`}>{statusLabel(thread.status)}</span>
      </span>
      {hasGoal ? (
        <span className={`session-goal ${thread.goalStatus ?? ""}`} title={thread.goalObjective ?? undefined}>
          <Target size={13} />
          <span className="session-goal-copy">
            <strong>{goalStatus}</strong>
            <small>{thread.goalObjective}</small>
          </span>
          {thread.goalTokenBudget ? (
            <span className="session-goal-budget">
              {formatTokens(thread.tokensUsed)} / {formatTokens(thread.goalTokenBudget)}
            </span>
          ) : null}
        </span>
      ) : null}
    </button>
  );
});

const SessionGroup = memo(function SessionGroup({
  title,
  threads,
  selectedThreadId,
  hasQuery,
  emptyLabel,
  emptyQueryLabel,
  onSelectThread
}: SessionGroupProps) {
  return (
    <div className="session-group">
      <h2 className="session-group-heading">
        <span>{title}</span>
        <span className="session-group-count">{threads.length}</span>
      </h2>
      {threads.length === 0 ? (
        <div className="empty-state compact">{hasQuery ? emptyQueryLabel : emptyLabel}</div>
      ) : null}
      {threads.map((thread) => (
        <SessionRow
          key={thread.id}
          thread={thread}
          selected={thread.id === selectedThreadId}
          onSelectThread={onSelectThread}
        />
      ))}
    </div>
  );
}, (previous: SessionGroupProps, next: SessionGroupProps) =>
  previous.title === next.title &&
  previous.threads === next.threads &&
  previous.hasQuery === next.hasQuery &&
  previous.emptyLabel === next.emptyLabel &&
  previous.emptyQueryLabel === next.emptyQueryLabel &&
  previous.onSelectThread === next.onSelectThread &&
  !selectionTouchesThreadGroup(next.threads, previous.selectedThreadId, next.selectedThreadId)
);

export const SessionSidebar = memo(function SessionSidebar({
  sessionCountLabel,
  queuedTaskCount,
  busy,
  theme,
  nextTheme,
  terminalVisible,
  sessionQuery,
  sessionList,
  selectedThreadId,
  onTerminalToggle,
  onThemeChange,
  onRefresh,
  onSessionQueryChange,
  onSelectThread
}: SessionSidebarProps) {
  return (
    <section className="sessions panel">
      <div className="panel-header sessions-header">
        <div className="sessions-title">
          <strong>codex-xyz</strong>
          <h1>Sessions</h1>
          <p>
            {sessionCountLabel}, {queuedTaskCount} active tasks
          </p>
        </div>
        <div className="panel-header-actions">
          {busy ? <Loader2 className="spin" size={18} /> : <History size={18} />}
          <button
            type="button"
            className={terminalVisible ? "active" : ""}
            title={terminalVisible ? "Hide terminal" : "Open terminal"}
            aria-label={terminalVisible ? "Hide terminal" : "Open terminal"}
            aria-pressed={terminalVisible}
            onClick={onTerminalToggle}
          >
            <Terminal size={16} />
          </button>
          <button
            type="button"
            className="theme-toggle"
            title={`Switch to ${nextTheme} mode`}
            aria-label={`Switch to ${nextTheme} mode`}
            aria-pressed={theme === "light"}
            onClick={() => onThemeChange(nextTheme)}
          >
            {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
          </button>
          <button title="Refresh" aria-label="Refresh" onClick={onRefresh}>
            <RefreshCw size={16} />
          </button>
        </div>
      </div>

      <label className="session-search">
        <Search size={14} />
        <input
          value={sessionQuery}
          onChange={(event) => onSessionQueryChange(event.target.value)}
          placeholder="Search sessions"
          aria-label="Search sessions"
        />
      </label>

      <div className="session-list" aria-label="Session list">
        <SessionGroup
          title="Active"
          threads={sessionList.activeThreads}
          selectedThreadId={selectedThreadId}
          hasQuery={sessionList.hasQuery}
          emptyLabel="No active sessions"
          emptyQueryLabel="No matching active sessions"
          onSelectThread={onSelectThread}
        />

        <SessionGroup
          title="Needs attention"
          threads={sessionList.attentionThreads}
          selectedThreadId={selectedThreadId}
          hasQuery={sessionList.hasQuery}
          emptyLabel="No attention needed"
          emptyQueryLabel="No matching attention"
          onSelectThread={onSelectThread}
        />

        <SessionGroup
          title="History"
          threads={sessionList.otherThreads}
          selectedThreadId={selectedThreadId}
          hasQuery={sessionList.hasQuery}
          emptyLabel="No history"
          emptyQueryLabel="No matching history"
          onSelectThread={onSelectThread}
        />
      </div>
    </section>
  );
});
