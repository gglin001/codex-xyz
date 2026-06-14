import { CheckCircle2, GitFork, MoreHorizontal, Pause, Play, RotateCw, Square, Trash2 } from "lucide-react";
import type { FocusEvent, KeyboardEvent, ReactNode } from "react";
import { useEffect, useState } from "react";
import type { ControlThread } from "../../server/domain.js";

type ControlMenuItem = {
  id: string;
  label: string;
  icon: ReactNode;
  disabled?: boolean;
  danger?: boolean;
  onSelect: () => void;
};

export type PromptControlMenuProps = {
  selectedThread: ControlThread | null;
  selectedThreadId: string | null;
  busy: boolean;
  onInterrupt: () => void;
  onResume: () => void;
  onFork: () => void;
  onPauseGoal: () => void;
  onResumeGoal: () => void;
  onCompleteGoal: () => void;
  onClearGoal: () => void;
  onOpenChange?: (open: boolean) => void;
};

function ControlMenuSection({ title, items }: { title: string; items: ControlMenuItem[] }) {
  if (items.length === 0) {
    return null;
  }

  return (
    <div className="prompt-control-section" role="group" aria-label={title}>
      <div className="prompt-control-section-title">{title}</div>
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          className={`prompt-control-item ${item.danger ? "danger" : ""}`}
          role="menuitem"
          disabled={item.disabled}
          onClick={item.onSelect}
        >
          {item.icon}
          <span>{item.label}</span>
        </button>
      ))}
    </div>
  );
}

export function PromptControlMenu({
  selectedThread,
  selectedThreadId,
  busy,
  onInterrupt,
  onResume,
  onFork,
  onPauseGoal,
  onResumeGoal,
  onCompleteGoal,
  onClearGoal,
  onOpenChange
}: PromptControlMenuProps) {
  const [open, setOpen] = useState(false);
  const goalStatus = selectedThread?.goalStatus ?? null;
  const hasGoal = Boolean(selectedThread?.goalObjective && goalStatus && goalStatus !== "cleared");
  const canPauseGoal = goalStatus === "in_progress";
  const canResumeGoal =
    goalStatus === "paused" || goalStatus === "blocked" || goalStatus === "usage_limited" || goalStatus === "budget_limited";
  const disabled = !selectedThreadId || busy;

  useEffect(() => {
    if (disabled) {
      setOpen(false);
    }
  }, [disabled]);

  useEffect(() => {
    onOpenChange?.(open);
  }, [onOpenChange, open]);

  useEffect(() => {
    return () => onOpenChange?.(false);
  }, [onOpenChange]);

  function select(action: () => void) {
    setOpen(false);
    action();
  }

  function handleBlur(event: FocusEvent<HTMLDivElement>) {
    const nextTarget = event.relatedTarget;
    if (!(nextTarget instanceof Node) || !event.currentTarget.contains(nextTarget)) {
      setOpen(false);
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
    }
  }

  const goalItems: ControlMenuItem[] = hasGoal
    ? [
        ...(canPauseGoal
          ? [
              {
                id: "pause-goal",
                label: "Pause",
                icon: <Pause size={15} />,
                onSelect: () => select(onPauseGoal)
              }
            ]
          : []),
        ...(canResumeGoal
          ? [
              {
                id: "resume-goal",
                label: "Resume",
                icon: <Play size={15} />,
                onSelect: () => select(onResumeGoal)
              }
            ]
          : []),
        ...(goalStatus !== "complete"
          ? [
              {
                id: "complete-goal",
                label: "Complete",
                icon: <CheckCircle2 size={15} />,
                onSelect: () => select(onCompleteGoal)
              }
            ]
          : []),
        {
          id: "clear-goal",
          label: "Clear",
          icon: <Trash2 size={15} />,
          danger: true,
          onSelect: () => select(onClearGoal)
        }
      ]
    : [];

  const sessionItems: ControlMenuItem[] = [
    {
      id: "interrupt-session",
      label: "Interrupt",
      icon: <Square size={15} />,
      disabled: selectedThread?.status !== "running",
      onSelect: () => select(onInterrupt)
    },
    {
      id: "resume-session",
      label: "Resume",
      icon: <RotateCw size={15} />,
      disabled: selectedThread?.status === "running",
      onSelect: () => select(onResume)
    },
    {
      id: "fork-session",
      label: "Fork",
      icon: <GitFork size={15} />,
      onSelect: () => select(onFork)
    }
  ];

  return (
    <div className={`prompt-control-menu ${open ? "open" : ""}`} onBlur={handleBlur} onKeyDown={handleKeyDown}>
      <button
        type="button"
        className="prompt-control-trigger"
        title="Controls"
        aria-label="Controls"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
      >
        <MoreHorizontal size={16} />
      </button>
      {open ? (
        <div className="prompt-control-popover" role="menu">
          <ControlMenuSection title="Goal" items={goalItems} />
          <ControlMenuSection title="Session" items={sessionItems} />
        </div>
      ) : null}
    </div>
  );
}
