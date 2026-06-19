import {
  Activity,
  ArrowLeft,
  Bot,
  ChevronDown,
  FileText,
  Info,
  ListChecks,
  Terminal,
  UserRound
} from "lucide-react";
import { AnimatePresence, LayoutGroup, motion } from "framer-motion";
import type { ReactNode } from "react";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import type { ControlThread, ItemType, ThreadDetail, ThreadItem } from "../../server/domain.js";
import {
  cn,
  pillClass,
  statusToneClass,
  subtleIconButtonClass
} from "../classNames.js";
import { fadePresence, listItemPresence, quickEase, revealPresence, smoothSpring, softSpring } from "../motion.js";
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

const itemToneClass: Record<ItemType, string> = {
  user: "border-l-fg-strong",
  agent: "border-l-running-dot",
  plan: "border-l-stale-dot",
  command: "border-l-muted",
  file: "border-l-completed-dot",
  system: "border-l-border-strong"
};

const itemIconToneClass: Record<ItemType, string> = {
  user: "bg-accent text-accent-fg",
  agent: "bg-running text-running-fg",
  plan: "bg-stale text-stale-fg",
  command: "bg-chip text-chip-fg",
  file: "bg-success text-success-fg",
  system: "bg-chip text-chip-fg"
};

export type ThreadDetailViewProps = {
  detail: ThreadDetail | null;
  selectedThread: ControlThread | null;
  selectedThreadId: string | null;
  detailWordWrap: boolean;
  onBack: () => void;
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
  if (status === "blocked" || status === "usage_limited" || status === "budget_limited") {
    return "attention";
  }
  if (status === "in_progress") {
    return "running";
  }
  if (status === "paused") {
    return "stale";
  }
  return "quiet";
}

const sessionFactCellClass = "w-max min-w-28 shrink-0 rounded-md border border-border-soft bg-surface px-3 py-2 shadow-control";
const sessionFactValueClass = "mt-1 block whitespace-nowrap text-[13px] font-semibold leading-5 text-fg-strong";

const SessionFacts = memo(
  function SessionFacts({ thread }: { thread: ThreadDetail }) {
    const visibleGoalStatus = thread.goalStatus && thread.goalStatus !== "cleared" ? thread.goalStatus : null;
    const visibleGoalObjective = visibleGoalStatus ? thread.goalObjective : null;

    return (
      <motion.div
        className="shrink-0 border-b border-border-soft bg-app-detail/95 px-4 py-3"
        variants={fadePresence}
        initial="initial"
        animate="animate"
        transition={quickEase}
      >
        <motion.div
          className="flex flex-nowrap gap-2 overflow-x-auto overflow-y-hidden pb-1"
          aria-label="Session status summary"
          initial="initial"
          animate="animate"
          variants={{
            initial: {},
            animate: {
              transition: {
                staggerChildren: 0.025
              }
            }
          }}
        >
          <motion.div className={sessionFactCellClass} variants={listItemPresence} transition={quickEase}>
            <span className="block text-[11px] font-medium uppercase leading-4 text-muted">Status</span>
            <strong className={cn("mt-1 inline-flex rounded-full px-2 py-1 text-[11px] font-semibold leading-none", statusToneClass[statusTone(thread.status)])}>{statusLabel(thread.status)}</strong>
          </motion.div>
          {visibleGoalObjective && visibleGoalStatus ? (
            <motion.div className={sessionFactCellClass} variants={listItemPresence} transition={quickEase}>
              <span className="block text-[11px] font-medium uppercase leading-4 text-muted">Goal</span>
              <strong
                className={cn(
                  "mt-1 block whitespace-nowrap rounded-full px-2 py-1 text-[11px] font-semibold leading-none",
                  statusToneClass[goalTone(visibleGoalStatus)]
                )}
                title={visibleGoalObjective}
              >
                {statusLabel(visibleGoalStatus)}: {visibleGoalObjective}
              </strong>
            </motion.div>
          ) : null}
          <motion.div className={sessionFactCellClass} variants={listItemPresence} transition={quickEase}>
            <span className="block text-[11px] font-medium uppercase leading-4 text-muted">Tokens</span>
            <strong className={sessionFactValueClass}>{formatTokens(thread.tokensUsed)}</strong>
          </motion.div>
          {thread.goalTokenBudget ? (
            <motion.div className={sessionFactCellClass} variants={listItemPresence} transition={quickEase}>
              <span className="block text-[11px] font-medium uppercase leading-4 text-muted">Budget</span>
              <strong className={sessionFactValueClass}>
                {formatTokens(thread.tokensUsed)} / {formatTokens(thread.goalTokenBudget)}
              </strong>
            </motion.div>
          ) : null}
          <motion.div className={sessionFactCellClass} variants={listItemPresence} transition={quickEase}>
            <span className="block text-[11px] font-medium uppercase leading-4 text-muted">Turns</span>
            <strong className={sessionFactValueClass}>{thread.turns.length}</strong>
          </motion.div>
          <motion.div className={sessionFactCellClass} variants={listItemPresence} transition={quickEase}>
            <span className="block text-[11px] font-medium uppercase leading-4 text-muted">Model</span>
            <strong className={sessionFactValueClass}>{thread.model ?? "default"}</strong>
          </motion.div>
          <motion.div className={sessionFactCellClass} variants={listItemPresence} transition={quickEase}>
            <span className="block text-[11px] font-medium uppercase leading-4 text-muted">Workdir</span>
            <strong className="mt-1 block whitespace-nowrap font-mono text-[12px] font-medium leading-5 text-fg-strong">{thread.cwd}</strong>
          </motion.div>
          <motion.div className={sessionFactCellClass} variants={listItemPresence} transition={quickEase}>
            <span className="block text-[11px] font-medium uppercase leading-4 text-muted">Session</span>
            <strong className="mt-1 block whitespace-nowrap font-mono text-[12px] font-medium leading-5 text-fg-strong">{shortId(thread.sessionId)}</strong>
          </motion.div>
          <motion.div className={sessionFactCellClass} variants={listItemPresence} transition={quickEase}>
            <span className="block text-[11px] font-medium uppercase leading-4 text-muted">Updated</span>
            <strong className={sessionFactValueClass}>{formatDateTime(thread.updatedAt)}</strong>
          </motion.div>
        </motion.div>
      </motion.div>
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
    <motion.article
      layout="position"
      className={cn("rounded-lg border border-border-soft border-l-2 bg-surface shadow-control transition duration-200 ease-snappy", itemToneClass[item.type])}
      variants={listItemPresence}
      initial="initial"
      animate="animate"
      transition={quickEase}
    >
      <motion.button
        type="button"
        className="flex min-h-10 w-full items-center gap-3 rounded-t-lg px-3 py-2 text-left transition duration-200 ease-snappy hover:bg-control-hover"
        aria-expanded={visible}
        aria-label={`${visible ? "Hide" : "Show"} ${title}`}
        whileHover={{ y: -1 }}
        whileTap={{ scale: 0.995 }}
        transition={quickEase}
        onClick={() => onToggleVisible(item.id)}
      >
        <span className="flex min-w-0 flex-1 items-center gap-2">
          <span className={cn("flex h-6 w-6 shrink-0 items-center justify-center rounded-md", itemIconToneClass[item.type])}>
            <ItemIcon item={item} />
          </span>
          <span className="truncate text-sm font-medium text-fg-strong">{title}</span>
        </span>
        <span className="flex shrink-0 items-center gap-1.5 text-[11px] text-muted">
          {status ? <span className={pillClass}>{readableStatus(status)}</span> : null}
          {exitCode !== null ? <span className={pillClass}>exit {exitCode}</span> : null}
          <time className="hidden sm:inline">{formatTime(item.createdAt)}</time>
          <motion.span animate={{ rotate: visible ? 180 : 0 }} transition={quickEase}>
            <ChevronDown size={14} />
          </motion.span>
        </span>
      </motion.button>
      <AnimatePresence initial={false}>
        {visible ? (
          <motion.div variants={revealPresence} initial="initial" animate="animate" exit="exit" transition={softSpring} className="overflow-hidden">
            <pre className="overflow-x-auto whitespace-pre-wrap border-t border-border-soft bg-surface-subtle p-3 font-mono text-[12px] leading-5 text-fg">{outputText}</pre>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </motion.article>
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
    <motion.div
      layout="position"
      className={cn("rounded-md border border-border-soft border-l-2 bg-surface shadow-control", itemToneClass[item.type])}
      variants={listItemPresence}
      initial="initial"
      animate="animate"
      transition={quickEase}
    >
      <motion.button
        type="button"
        className={cn(
          "flex min-h-9 w-full items-center gap-3 rounded-t-md px-3 py-2 text-left transition duration-200 ease-snappy",
          canCollapse ? "hover:bg-control-hover" : "cursor-default"
        )}
        aria-expanded={canCollapse ? expanded : undefined}
        aria-label={canCollapse ? `${expanded ? "Collapse" : "Expand"} ${title}` : undefined}
        whileHover={canCollapse ? { y: -1 } : undefined}
        whileTap={canCollapse ? { scale: 0.995 } : undefined}
        transition={quickEase}
        onClick={canCollapse ? () => onToggleExpanded(item.id) : undefined}
      >
        <span className="flex min-w-0 flex-1 items-center gap-2">
          <span className={cn("flex h-5 w-5 shrink-0 items-center justify-center rounded", itemIconToneClass[item.type])}>
            <ItemIcon item={item} />
          </span>
          <span className="truncate text-[13px] font-medium text-fg-strong">{title}</span>
        </span>
        <span className="flex shrink-0 items-center gap-1.5 text-[11px] text-muted">
          {status ? <span className={pillClass}>{readableStatus(status)}</span> : null}
          {exitCode !== null ? <span className={pillClass}>exit {exitCode}</span> : null}
          <time className="hidden sm:inline">{formatTime(item.createdAt)}</time>
          {canCollapse ? (
            <motion.span animate={{ rotate: expanded ? 180 : 0 }} transition={quickEase}>
              <ChevronDown size={14} />
            </motion.span>
          ) : null}
        </span>
      </motion.button>
      <motion.pre
        layout
        className="overflow-x-auto whitespace-pre-wrap border-t border-border-soft bg-surface-subtle p-3 font-mono text-[12px] leading-5 text-fg"
        transition={softSpring}
      >
        {visibleText}
      </motion.pre>
    </motion.div>
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
    <motion.article
      layout="position"
      className="rounded-lg border border-border-soft bg-surface shadow-control"
      variants={listItemPresence}
      initial="initial"
      animate="animate"
      transition={quickEase}
    >
      <motion.button
        type="button"
        className="flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left transition duration-200 ease-snappy hover:bg-control-hover"
        aria-expanded={expanded}
        aria-label={`${expanded ? "Collapse" : "Expand"} ${summary.title}`}
        whileHover={{ y: -1 }}
        whileTap={{ scale: 0.995 }}
        transition={quickEase}
        onClick={() => onToggleExpanded(group.id)}
      >
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-2">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-chip text-chip-fg">
              <Activity size={15} />
            </span>
            <span className="truncate text-sm font-medium text-fg-strong">{summary.title}</span>
          </span>
          <span className="mt-1 block truncate text-[12px] leading-4 text-muted">{summary.preview || summary.detail}</span>
        </span>
        <span className="flex shrink-0 items-center gap-1.5 text-[11px] text-muted">
          <span className={pillClass}>{summary.count}</span>
          {summary.status ? <span className={pillClass}>{readableStatus(summary.status)}</span> : null}
          <time className="hidden sm:inline">{formatTime(group.updatedAt)}</time>
          <motion.span animate={{ rotate: expanded ? 180 : 0 }} transition={quickEase}>
            <ChevronDown size={14} />
          </motion.span>
        </span>
      </motion.button>
      <AnimatePresence initial={false}>
        {expanded ? (
          <motion.div
            className="grid gap-2 overflow-hidden border-t border-border-soft bg-surface-subtle/60 p-2"
            variants={revealPresence}
            initial="initial"
            animate="animate"
            exit="exit"
            transition={softSpring}
          >
            {group.items.map((item) => (
              <ProcessStep
                key={item.id}
                item={item}
                expanded={expandedStepIds.has(item.id)}
                onToggleExpanded={toggleExpandedStep}
              />
            ))}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </motion.article>
  );
});

const Transcript = memo(function Transcript({
  detail,
  hasSelection,
  detailWordWrap
}: {
  detail: ThreadDetail | null;
  hasSelection: boolean;
  detailWordWrap: boolean;
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
    <div
      className={cn(
        "min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-4 py-4",
        detailWordWrap ? "[&_pre]:whitespace-pre-wrap" : "[&_pre]:whitespace-pre"
      )}
      aria-label="Session transcript"
    >
      <LayoutGroup id="thread-transcript">
        <motion.div className="mx-auto flex min-h-full w-full max-w-[920px] flex-col gap-3" layout>
          <AnimatePresence initial={false}>
            {!detail ? (
              <motion.div
                className="flex min-h-48 flex-1 items-center justify-center rounded-lg border border-dashed border-border-soft bg-surface-subtle/45 text-sm text-muted"
                variants={fadePresence}
                initial="initial"
                animate="animate"
                exit="exit"
                transition={quickEase}
              >
                {hasSelection ? "Loading session..." : "No session selected"}
              </motion.div>
            ) : null}
          </AnimatePresence>
          <AnimatePresence initial={false}>
            {detail?.items.length === 0 ? (
              <motion.div
                className="flex min-h-48 flex-1 items-center justify-center rounded-lg border border-dashed border-border-soft bg-surface-subtle/45 text-sm text-muted"
                variants={fadePresence}
                initial="initial"
                animate="animate"
                exit="exit"
                transition={quickEase}
              >
                No transcript items yet
              </motion.div>
            ) : null}
          </AnimatePresence>
          {showWindowControls ? (
            <motion.div
              className="sticky top-0 z-10 flex items-center justify-between gap-3 rounded-lg border border-border-soft bg-app-detail/90 p-2 text-xs text-muted shadow-control backdrop-blur-xl"
              variants={listItemPresence}
              initial="initial"
              animate="animate"
              transition={quickEase}
            >
              <span className="px-1">{windowSummary}</span>
              <div className="flex rounded-md border border-border-soft bg-surface-subtle p-0.5" role="group" aria-label="Transcript range">
                <button
                  type="button"
                  className={cn("h-7 rounded px-2 text-xs font-medium text-muted-strong transition duration-200 ease-snappy hover:text-fg-strong", windowMode === "recent" ? "bg-control-hover text-fg-strong" : null)}
                  aria-pressed={windowMode === "recent"}
                  onClick={() => setWindowMode("recent")}
                >
                  Recent
                </button>
                <button
                  type="button"
                  className={cn("h-7 rounded px-2 text-xs font-medium text-muted-strong transition duration-200 ease-snappy hover:text-fg-strong", windowMode === "all" ? "bg-control-hover text-fg-strong" : null)}
                  aria-pressed={windowMode === "all"}
                  onClick={() => setWindowMode("all")}
                >
                  All
                </button>
              </div>
            </motion.div>
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
        </motion.div>
      </LayoutGroup>
    </div>
  );
});

export const ThreadDetailView = memo(function ThreadDetailView({
  detail,
  selectedThread,
  selectedThreadId,
  detailWordWrap,
  onBack,
  composer = null
}: ThreadDetailViewProps) {
  return (
    <motion.section
      layout
      className="flex h-full min-h-0 flex-col bg-app-detail md:rounded-lg md:border md:border-border-soft md:shadow-panel"
      data-detail-word-wrap={detailWordWrap ? "true" : "false"}
      transition={smoothSpring}
    >
      <div className="flex h-14 shrink-0 items-center gap-3 border-b border-border-soft bg-app-detail/95 px-4 md:rounded-t-lg">
        <button
          type="button"
          className={cn(subtleIconButtonClass, "md:hidden")}
          title="Back to sessions"
          aria-label="Back to sessions"
          onClick={onBack}
        >
          <ArrowLeft size={18} />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-sm font-semibold leading-5 text-fg-strong">{selectedThread?.title ?? "Session"}</h1>
          <p className="truncate text-[11px] leading-4 text-muted">{selectedThread?.cwd ?? "Select a session to inspect the transcript"}</p>
        </div>
      </div>

      {detail ? <SessionFacts thread={detail} /> : null}

      <Transcript detail={detail} hasSelection={Boolean(selectedThreadId)} detailWordWrap={detailWordWrap} />

      {composer}
    </motion.section>
  );
});
