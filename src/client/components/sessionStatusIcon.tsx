import {
  Circle,
  CircleDotDashed,
  CirclePause,
  CircleStop,
  Loader2
} from "lucide-react"
import type { RuntimeStatus } from "../../server/domain.js"
import { cn, tone } from "../designSystem.js"

export const sessionStatusDotClass: Record<RuntimeStatus, string> = {
  running: tone.running.dot,
  idle: tone.neutral.dot,
  stale: tone.stale.dot,
  interrupted: tone.error.dot,
  failed: tone.error.dot,
  completed: tone.completed.dot
}

export function SessionStatusIcon({
  status,
  size = 14,
  className
}: {
  status: RuntimeStatus
  size?: number
  className?: string
}) {
  if (status === "running") {
    return <Loader2 size={size} className={cn("animate-spin", tone.running.icon, className)} />
  }
  if (status === "idle") {
    return <CirclePause size={size} className={cn(tone.completed.icon, className)} />
  }
  if (status === "completed") {
    return <CircleStop size={size} className={cn(tone.completed.icon, className)} />
  }
  if (status === "stale") {
    return <CircleDotDashed size={size} className={cn(tone.stale.icon, className)} />
  }
  return <Circle size={size} className={cn(tone.error.icon, className)} />
}
