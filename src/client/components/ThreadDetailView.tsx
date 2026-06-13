import {
  Activity,
  ArrowLeft,
  Bot,
  Check,
  ChevronDown,
  ChevronUp,
  FileText,
  GitFork,
  Info,
  ListChecks,
  RotateCw,
  Square,
  Terminal,
  UserRound
} from "lucide-react";
import type { FormEvent, ReactNode } from "react";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import type { ControlThread, QueuedPrompt, ThreadDetail, ThreadItem } from "../../server/domain.js";
import { getCollapsedTextPreview } from "../textPreview.js";
import { getTranscriptEntries, type TranscriptProcessEntry } from "../transcriptEntries.js";
import {
  defaultTranscriptWindowThreshold,
  getTranscriptWindow,
  type TranscriptWindowMode
} from "../transcriptWindow.js";
import {
  formatDateTime,
  formatTime,
  formatTokens,
  itemTitle,
  shortId,
  statusLabel,
  statusTone
} from "../uiFormat.js";

const processStepPreviewLineCount = 3;
const processPreviewItemCount = 3;
const queuedPromptPreviewCount = 3;

export type ThreadDetailViewProps = {
  detail: ThreadDetail | null;
  selectedThread: ControlThread | null;
  selectedThreadId: string | null;
  busy: boolean;
  renameTitle: string;
  canRename: boolean;
  onBack: () => void;
  onRenameTitleChange: (value: string) => void;
  onRenameSubmit: (event: FormEvent) => void;
  onInterrupt: () => void;
  onResume: () => void;
  onFork: () => void;
  composer?: ReactNode;
};

function ItemIcon({ item }: { item: ThreadItem }) {
  if (item.type === "agent") {
    return <Bot size={15} />;
  }
  if (item.type === "user") {
    return <UserRound size={15} />;
  }
  if (item.type === "plan") {
    return <ListChecks size={15} />;
  }
  if (item.type === "command") {
    return <Terminal size={15} />;
  }
  if (item.type === "file") {
    return <FileText size={15} />;
  }
  return <Info size={15} />;
}

function readableStatus(value: string) {
  return value.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " ").toLowerCase();
}

function firstTextLine(value: string) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean) ?? "";
}

function itemCommandLabel(item: ThreadItem) {
  const command = typeof item.data.command === "string" ? item.data.command.trim() : "";
  if (command) {
    return `$ ${command}`;
  }
  return firstTextLine(item.text);
}

function processItemPreview(item: ThreadItem) {
  if (item.type === "command") {
    return itemCommandLabel(item) || "Command";
  }

  const firstLine = firstTextLine(item.text);
  if (!firstLine) {
    return itemTitle(item);
  }
  const title = itemTitle(item);
  if (title === firstLine || firstLine.toLowerCase().startsWith(`${title.toLowerCase()}:`)) {
    return firstLine;
  }
  return `${title}: ${firstLine}`;
}

function processGroupStatus(items: ThreadItem[]) {
  let sawCompleted = false;
  for (const item of items) {
    const status = typeof item.data.status === "string" ? item.data.status : null;
    const exitCode = typeof item.data.exitCode === "number" ? item.data.exitCode : null;

    if (status === "inProgress" || status === "running") {
      return "running";
    }
    if (status === "failed" || status === "declined" || (exitCode !== null && exitCode !== 0)) {
      return "failed";
    }
    sawCompleted = sawCompleted || status === "completed" || exitCode === 0;
  }
  return sawCompleted ? "completed" : null;
}

function summarizeProcessGroup(items: ThreadItem[]) {
  const titles = Array.from(new Set(items.map((item) => itemTitle(item))));
  const title = titles.length === 1 ? titles[0] : "Process";
  const detail =
    titles.length <= 3 ? titles.join(", ") : `${titles.slice(0, 2).join(", ")} + ${titles.length - 2} more`;
  const previewItems = items
    .map(processItemPreview)
    .filter(Boolean)
    .slice(0, processPreviewItemCount);
  const extraCount = Math.max(0, items.length - previewItems.length);
  const preview = `${previewItems.join(" · ")}${extraCount > 0 ? ` · +${extraCount} more` : ""}`;

  return {
    title,
    detail,
    preview,
    status: processGroupStatus(items),
    count: `${items.length} ${items.length === 1 ? "item" : "items"}`
  };
}

function goalTone(status: string) {
  if (status === "blocked") {
    return "attention";
  }
  if (status === "in_progress") {
    return "running";
  }
  return "quiet";
}

const SessionFacts = memo(
  function SessionFacts({ thread }: { thread: ThreadDetail }) {
    const visibleGoalStatus = thread.goalStatus && thread.goalStatus !== "cleared" ? thread.goalStatus : null;
    const visibleGoalObjective = visibleGoalStatus ? thread.goalObjective : null;

    return (
      <div className="session-facts">
        <div>
          <span>Status</span>
          <strong className={`fact-status ${statusTone(thread.status)}`}>{statusLabel(thread.status)}</strong>
        </div>
        {visibleGoalObjective && visibleGoalStatus ? (
          <div className="wide">
            <span>Goal</span>
            <strong className={`fact-status ${goalTone(visibleGoalStatus)}`} title={visibleGoalObjective}>
              {statusLabel(visibleGoalStatus)}: {visibleGoalObjective}
            </strong>
          </div>
        ) : null}
        <div>
          <span>Tokens</span>
          <strong>{formatTokens(thread.tokensUsed)}</strong>
        </div>
        {thread.goalTokenBudget ? (
          <div>
            <span>Budget</span>
            <strong>
              {formatTokens(thread.tokensUsed)} / {formatTokens(thread.goalTokenBudget)}
            </strong>
          </div>
        ) : null}
        <div>
          <span>Turns</span>
          <strong>{thread.turns.length}</strong>
        </div>
        <div>
          <span>Model</span>
          <strong>{thread.model ?? "default"}</strong>
        </div>
        <div className="wide">
          <span>Workdir</span>
          <strong>{thread.cwd}</strong>
        </div>
        <div>
          <span>Session</span>
          <strong>{shortId(thread.sessionId)}</strong>
        </div>
        <div>
          <span>Updated</span>
          <strong>{formatDateTime(thread.updatedAt)}</strong>
        </div>
      </div>
    );
  },
  (previous, next) =>
    previous.thread.status === next.thread.status &&
    previous.thread.tokensUsed === next.thread.tokensUsed &&
    previous.thread.turns.length === next.thread.turns.length &&
    previous.thread.model === next.thread.model &&
    previous.thread.cwd === next.thread.cwd &&
    previous.thread.sessionId === next.thread.sessionId &&
    previous.thread.updatedAt === next.thread.updatedAt &&
    previous.thread.goalObjective === next.thread.goalObjective &&
    previous.thread.goalStatus === next.thread.goalStatus &&
    previous.thread.goalTokenBudget === next.thread.goalTokenBudget
);

const QueuedPromptPanel = memo(function QueuedPromptPanel({ prompts }: { prompts: QueuedPrompt[] }) {
  const [expanded, setExpanded] = useState(false);
  const promptKey = prompts.map((prompt) => prompt.id).join(":");
  const canExpand = prompts.length > queuedPromptPreviewCount;
  const visiblePrompts = expanded ? prompts : prompts.slice(0, queuedPromptPreviewCount);
  const hiddenCount = Math.max(0, prompts.length - visiblePrompts.length);

  useEffect(() => {
    setExpanded(false);
  }, [promptKey]);

  if (prompts.length === 0) {
    return null;
  }

  return (
    <article className={`queued-prompts ${expanded ? "expanded" : "collapsed"}`}>
      <button
        type="button"
        className={`queued-prompts-toggle ${canExpand ? "" : "static"}`}
        aria-expanded={canExpand ? expanded : undefined}
        aria-label={canExpand ? `${expanded ? "Collapse" : "Expand"} queued prompts` : undefined}
        onClick={canExpand ? () => setExpanded((current) => !current) : undefined}
      >
        <span className="queued-prompts-title">
          <ListChecks size={15} />
          <span>Queued prompts</span>
        </span>
        <span className="queued-prompts-meta">
          <span className="item-chip">{prompts.length}</span>
          {canExpand ? (expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />) : null}
        </span>
      </button>
      <div className="queued-prompts-body">
        {visiblePrompts.map((prompt, index) => (
          <div className="queued-prompt" key={prompt.id}>
            <span className="queued-prompt-index">{index + 1}</span>
            <pre>{prompt.prompt}</pre>
          </div>
        ))}
        {hiddenCount > 0 ? <div className="queued-prompt-more">+{hiddenCount} more queued</div> : null}
      </div>
    </article>
  );
});

const TranscriptItem = memo(function TranscriptItem({
  item,
  visible,
  onToggleVisible
}: {
  item: ThreadItem;
  visible: boolean;
  onToggleVisible: (itemId: string) => void;
}) {
  const status = typeof item.data.status === "string" ? item.data.status : null;
  const exitCode = typeof item.data.exitCode === "number" ? item.data.exitCode : null;
  const outputText = item.text || "Pending...";
  const title = itemTitle(item);

  return (
    <article className={`transcript-item ${item.type} ${visible ? "expanded" : "collapsed"}`}>
      <button
        type="button"
        className="item-meta"
        aria-expanded={visible}
        aria-label={`${visible ? "Hide" : "Show"} ${title}`}
        onClick={() => onToggleVisible(item.id)}
      >
        <span className="item-title">
          <ItemIcon item={item} />
          <span>{title}</span>
        </span>
        <span className="item-meta-right">
          {status ? <span className="item-chip">{status}</span> : null}
          {exitCode !== null ? <span className="item-chip">exit {exitCode}</span> : null}
          <time>{formatTime(item.createdAt)}</time>
          {visible ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </span>
      </button>
      {visible ? <pre>{outputText}</pre> : null}
    </article>
  );
});

const ProcessStep = memo(function ProcessStep({
  item,
  expanded,
  onToggleExpanded
}: {
  item: ThreadItem;
  expanded: boolean;
  onToggleExpanded: (itemId: string) => void;
}) {
  const status = typeof item.data.status === "string" ? item.data.status : null;
  const exitCode = typeof item.data.exitCode === "number" ? item.data.exitCode : null;
  const outputText = item.text || "Pending...";
  const textPreview = getCollapsedTextPreview(outputText, {
    expanded,
    lineCount: processStepPreviewLineCount
  });
  const visibleText = textPreview.visibleText;
  const canCollapse = textPreview.canCollapse;
  const title = itemTitle(item);

  return (
    <div className={`process-step ${item.type}`}>
      <button
        type="button"
        className={`process-step-toggle ${canCollapse ? "" : "static"}`}
        aria-expanded={canCollapse ? expanded : undefined}
        aria-label={canCollapse ? `${expanded ? "Collapse" : "Expand"} ${title}` : undefined}
        onClick={canCollapse ? () => onToggleExpanded(item.id) : undefined}
      >
        <span className="process-step-title">
          <ItemIcon item={item} />
          <span>{title}</span>
        </span>
        <span className="process-step-right">
          {status ? <span className="item-chip">{readableStatus(status)}</span> : null}
          {exitCode !== null ? <span className="item-chip">exit {exitCode}</span> : null}
          <time>{formatTime(item.createdAt)}</time>
          {canCollapse ? (expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />) : null}
        </span>
      </button>
      <pre>{visibleText}</pre>
    </div>
  );
});

const ProcessGroup = memo(function ProcessGroup({
  group,
  expanded,
  onToggleExpanded
}: {
  group: TranscriptProcessEntry;
  expanded: boolean;
  onToggleExpanded: (entryId: string) => void;
}) {
  const summary = summarizeProcessGroup(group.items);
  const [expandedStepIds, setExpandedStepIds] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    setExpandedStepIds(new Set());
  }, [group.id]);

  useEffect(() => {
    if (!expanded) {
      setExpandedStepIds(new Set());
    }
  }, [expanded]);

  const toggleExpandedStep = useCallback((itemId: string) => {
    setExpandedStepIds((current) => {
      const next = new Set(current);
      if (next.has(itemId)) {
        next.delete(itemId);
      } else {
        next.add(itemId);
      }
      return next;
    });
  }, []);

  return (
    <article className={`process-group ${expanded ? "expanded" : "collapsed"}`}>
      <button
        type="button"
        className="process-group-toggle"
        aria-expanded={expanded}
        aria-label={`${expanded ? "Collapse" : "Expand"} ${summary.title}`}
        onClick={() => onToggleExpanded(group.id)}
      >
        <span className="process-group-main">
          <span className="process-group-title">
            <Activity size={15} />
            <span>{summary.title}</span>
          </span>
          <span className="process-group-preview">{summary.preview || summary.detail}</span>
        </span>
        <span className="process-group-meta">
          <span className="item-chip">{summary.count}</span>
          {summary.status ? <span className="item-chip">{readableStatus(summary.status)}</span> : null}
          <time>{formatTime(group.updatedAt)}</time>
          {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </span>
      </button>
      {expanded ? (
        <div className="process-group-body">
          {group.items.map((item) => (
            <ProcessStep
              key={item.id}
              item={item}
              expanded={expandedStepIds.has(item.id)}
              onToggleExpanded={toggleExpandedStep}
            />
          ))}
        </div>
      ) : null}
    </article>
  );
});

const Transcript = memo(function Transcript({
  detail,
  hasSelection
}: {
  detail: ThreadDetail | null;
  hasSelection: boolean;
}) {
  const [expandedProcessEntryIds, setExpandedProcessEntryIds] = useState<Set<string>>(() => new Set());
  const [hiddenItemIds, setHiddenItemIds] = useState<Set<string>>(() => new Set());
  const [windowMode, setWindowMode] = useState<TranscriptWindowMode>("recent");

  useEffect(() => {
    setExpandedProcessEntryIds(new Set());
    setHiddenItemIds(new Set());
    setWindowMode("recent");
  }, [detail?.id]);

  const toggleExpandedProcessEntry = useCallback((entryId: string) => {
    setExpandedProcessEntryIds((current) => {
      const next = new Set(current);
      if (next.has(entryId)) {
        next.delete(entryId);
      } else {
        next.add(entryId);
      }
      return next;
    });
  }, []);

  const toggleItemVisibility = useCallback((itemId: string) => {
    setHiddenItemIds((current) => {
      const next = new Set(current);
      if (next.has(itemId)) {
        next.delete(itemId);
      } else {
        next.add(itemId);
      }
      return next;
    });
  }, []);

  const transcriptWindow = useMemo(
    () => getTranscriptWindow(detail?.items ?? [], windowMode),
    [detail?.items, windowMode]
  );
  const showWindowControls = Boolean(detail && detail.items.length > defaultTranscriptWindowThreshold);
  const windowSummary =
    windowMode === "recent" && transcriptWindow.isWindowed
      ? `${transcriptWindow.visibleCount} / ${transcriptWindow.totalCount} items`
      : `${transcriptWindow.totalCount} items`;
  const transcriptEntries = useMemo(() => getTranscriptEntries(transcriptWindow.items), [transcriptWindow.items]);

  return (
    <div className="transcript" aria-label="Session transcript">
      {!detail ? <div className="empty-state">{hasSelection ? "Loading session..." : "No session selected"}</div> : null}
      {detail?.items.length === 0 ? <div className="empty-state">No transcript items yet</div> : null}
      {showWindowControls ? (
        <div className="transcript-window-bar">
          <span>{windowSummary}</span>
          <div className="transcript-window-mode" role="group" aria-label="Transcript range">
            <button
              type="button"
              className={windowMode === "recent" ? "active" : ""}
              aria-pressed={windowMode === "recent"}
              onClick={() => setWindowMode("recent")}
            >
              Recent
            </button>
            <button
              type="button"
              className={windowMode === "all" ? "active" : ""}
              aria-pressed={windowMode === "all"}
              onClick={() => setWindowMode("all")}
            >
              All
            </button>
          </div>
        </div>
      ) : null}
      {transcriptEntries.map((entry) =>
        entry.kind === "process" ? (
          <ProcessGroup
            key={entry.id}
            group={entry}
            expanded={expandedProcessEntryIds.has(entry.id)}
            onToggleExpanded={toggleExpandedProcessEntry}
          />
        ) : (
          <TranscriptItem
            key={entry.id}
            item={entry.item}
            visible={!hiddenItemIds.has(entry.item.id)}
            onToggleVisible={toggleItemVisibility}
          />
        )
      )}
    </div>
  );
});

export const ThreadDetailView = memo(function ThreadDetailView({
  detail,
  selectedThread,
  selectedThreadId,
  busy,
  renameTitle,
  canRename,
  onBack,
  onRenameTitleChange,
  onRenameSubmit,
  onInterrupt,
  onResume,
  onFork,
  composer = null
}: ThreadDetailViewProps) {
  return (
    <section className="detail panel">
      <div className="detail-header">
        <button
          type="button"
          className="mobile-back-button"
          title="Back to sessions"
          aria-label="Back to sessions"
          onClick={onBack}
        >
          <ArrowLeft size={18} />
        </button>
        <div className="title-stack">
          {selectedThread ? (
            <form className="title-editor" onSubmit={onRenameSubmit}>
              <input
                value={renameTitle}
                onChange={(event) => onRenameTitleChange(event.target.value)}
                disabled={busy}
                aria-label="Session title"
              />
              <button title="Save title" disabled={!canRename}>
                <Check size={16} />
              </button>
            </form>
          ) : (
            <h1>Session</h1>
          )}
        </div>
        <div className="toolbar">
          <button
            title="Interrupt"
            aria-label="Interrupt"
            disabled={!selectedThreadId || selectedThread?.status !== "running" || busy}
            onClick={onInterrupt}
          >
            <Square size={16} />
          </button>
          <button
            title="Resume"
            aria-label="Resume"
            disabled={!selectedThreadId || selectedThread?.status === "running" || busy}
            onClick={onResume}
          >
            <RotateCw size={16} />
          </button>
          <button title="Fork" aria-label="Fork" disabled={!selectedThreadId || busy} onClick={onFork}>
            <GitFork size={16} />
          </button>
        </div>
      </div>

      {detail ? <SessionFacts thread={detail} /> : null}

      {detail ? <QueuedPromptPanel prompts={detail.queuedPrompts} /> : null}

      <Transcript detail={detail} hasSelection={Boolean(selectedThreadId)} />

      {composer}
    </section>
  );
});
