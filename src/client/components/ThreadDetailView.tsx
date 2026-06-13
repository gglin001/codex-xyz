import {
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
import type { ControlThread, ThreadDetail, ThreadItem } from "../../server/domain.js";
import { getCollapsedTextPreview } from "../textPreview.js";
import {
  defaultTranscriptWindowThreshold,
  getTranscriptWindow,
  type TranscriptWindowMode
} from "../transcriptWindow.js";
import {
  formatDateTime,
  formatTime,
  formatTokens,
  itemDefaultsCollapsed,
  itemTitle,
  shortId,
  statusLabel,
  statusTone
} from "../uiFormat.js";

const collapsedPreviewLineCount = 2;

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

const SessionFacts = memo(
  function SessionFacts({ thread }: { thread: ThreadDetail }) {
    return (
      <div className="session-facts">
        <div>
          <span>Status</span>
          <strong className={`fact-status ${statusTone(thread.status)}`}>{statusLabel(thread.status)}</strong>
        </div>
        <div>
          <span>Tokens</span>
          <strong>{formatTokens(thread.tokensUsed)}</strong>
        </div>
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
    previous.thread.updatedAt === next.thread.updatedAt
);

const TranscriptItem = memo(function TranscriptItem({
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
  const textPreview = itemDefaultsCollapsed(item)
    ? getCollapsedTextPreview(outputText, {
        expanded,
        lineCount: collapsedPreviewLineCount
      })
    : {
        canCollapse: false,
        visibleText: outputText
      };
  const canCollapse = textPreview.canCollapse;
  const visibleText = textPreview.visibleText;
  const title = itemTitle(item);

  return (
    <article className={`transcript-item ${item.type}`}>
      <div className="item-meta">
        <span className="item-title">
          <ItemIcon item={item} />
          <span>{title}</span>
        </span>
        <span className="item-meta-right">
          {status ? <span className="item-chip">{status}</span> : null}
          {exitCode !== null ? <span className="item-chip">exit {exitCode}</span> : null}
          {canCollapse ? (
            <button
              type="button"
              className="item-expand"
              aria-expanded={expanded}
              aria-label={`${expanded ? "Collapse" : "Expand"} ${title}`}
              onClick={() => onToggleExpanded(item.id)}
            >
              {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              <span>{expanded ? "Collapse" : "Expand"}</span>
            </button>
          ) : null}
          <time>{formatTime(item.createdAt)}</time>
        </span>
      </div>
      <pre>{visibleText}</pre>
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
  const [expandedItemIds, setExpandedItemIds] = useState<Set<string>>(() => new Set());
  const [windowMode, setWindowMode] = useState<TranscriptWindowMode>("recent");

  useEffect(() => {
    setExpandedItemIds(new Set());
    setWindowMode("recent");
  }, [detail?.id]);

  const toggleExpandedItem = useCallback((itemId: string) => {
    setExpandedItemIds((current) => {
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
      {transcriptWindow.items.map((item) => (
        <TranscriptItem
          key={item.id}
          item={item}
          expanded={expandedItemIds.has(item.id)}
          onToggleExpanded={toggleExpandedItem}
        />
      ))}
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
          <p>
            {selectedThread ? `${statusLabel(selectedThread.status)} · ${formatDateTime(selectedThread.updatedAt)}` : "idle"}
          </p>
        </div>
        <div className="toolbar">
          <button
            title="Interrupt"
            disabled={!selectedThreadId || selectedThread?.status !== "running" || busy}
            onClick={onInterrupt}
          >
            <Square size={16} />
            <span>Interrupt</span>
          </button>
          <button
            title="Resume"
            disabled={!selectedThreadId || selectedThread?.status === "running" || busy}
            onClick={onResume}
          >
            <RotateCw size={16} />
            <span>Resume</span>
          </button>
          <button title="Fork" disabled={!selectedThreadId || busy} onClick={onFork}>
            <GitFork size={16} />
            <span>Fork</span>
          </button>
        </div>
      </div>

      {detail ? <SessionFacts thread={detail} /> : null}

      <Transcript detail={detail} hasSelection={Boolean(selectedThreadId)} />

      {composer}
    </section>
  );
});
