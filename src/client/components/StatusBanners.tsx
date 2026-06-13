import { memo } from "react";

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
  return (
    <>
      {busyAction ? <div className="status-banner neutral">{busyAction}...</div> : null}
      {notice ? <div className="status-banner success">{notice}</div> : null}
      {error ? <div className="status-banner error">{error}</div> : null}
    </>
  );
});
