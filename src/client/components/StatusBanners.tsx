import { memo } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { cn } from "../classNames.js";
import { listItemPresence, quickEase } from "../motion.js";

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
    <motion.div className="grid gap-2" layout>
      <AnimatePresence initial={false}>
        {busyAction ? (
          <motion.div
            key="busy"
            className={cn(bannerClass, "border-border bg-chip text-chip-fg")}
            variants={listItemPresence}
            initial="initial"
            animate="animate"
            exit="exit"
            transition={quickEase}
          >
            {busyAction}...
          </motion.div>
        ) : null}
        {notice ? (
          <motion.div
            key="notice"
            className={cn(bannerClass, "border-running/40 bg-success text-success-fg")}
            variants={listItemPresence}
            initial="initial"
            animate="animate"
            exit="exit"
            transition={quickEase}
          >
            {notice}
          </motion.div>
        ) : null}
        {error ? (
          <motion.div
            key="error"
            className={cn(bannerClass, "border-attention/40 bg-error text-error-fg")}
            variants={listItemPresence}
            initial="initial"
            animate="animate"
            exit="exit"
            transition={quickEase}
          >
            {error}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </motion.div>
  );
});
