import { Bot, History } from "lucide-react";
import { memo } from "react";
import type { MobileView } from "./types.js";

export type MobileNavigationProps = {
  view: MobileView;
  hasSelection: boolean;
  onViewChange: (view: MobileView) => void;
};

export const MobileNavigation = memo(function MobileNavigation({
  view,
  hasSelection,
  onViewChange
}: MobileNavigationProps) {
  return (
    <nav className="mobile-nav" aria-label="Mobile views">
      <button
        type="button"
        className={view === "sessions" ? "active" : ""}
        aria-pressed={view === "sessions"}
        onClick={() => onViewChange("sessions")}
      >
        <History size={16} />
        <span>Sessions</span>
      </button>
      <button
        type="button"
        className={view === "detail" ? "active" : ""}
        aria-pressed={view === "detail"}
        disabled={!hasSelection}
        onClick={() => onViewChange("detail")}
      >
        <Bot size={16} />
        <span>Session</span>
      </button>
    </nav>
  );
});
