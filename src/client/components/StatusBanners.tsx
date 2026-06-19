import { memo } from "react";
import { cn } from "../classNames.js";

export type StatusBannersProps = {
  busyAction: string | null;
  notice: string | null;
  error: string | null;
};

export const StatusBanners = memo(function StatusBanners({
  busyAction,
  notice,
  error
}: StatusBannersProps) {
  const bannerClass =
    "rounded-md border px-3 py-2 text-[12px] font-medium leading-4"

  return (
    <div className="grid gap-2">
      {busyAction ? <div className={cn(bannerClass, "border-border bg-chip text-chip-fg")}>{busyAction}...</div> : null}
      {notice ? <div className={cn(bannerClass, "border-running/40 bg-success text-success-fg")}>{notice}</div> : null}
      {error ? <div className={cn(bannerClass, "border-attention/40 bg-error text-error-fg")}>{error}</div> : null}
    </div>
  );
});
