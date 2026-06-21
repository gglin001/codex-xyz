import {
  Circle,
  CircleDotDashed,
  CirclePause,
  CircleStop,
  Loader2
} from "lucide-react"
import type { SessionDisplayStatus } from "../../server/domain.js"
import { cn, tone } from "../designSystem.js"

export const sessionStatusDotClass: Record<SessionDisplayStatus, string> = {
  active: tone.running.dot,
  idle: tone.neutral.dot,
  not_loaded: tone.stale.dot,
  system_error: tone.error.dot,
  turn_interrupted: tone.error.dot,
  turn_failed: tone.error.dot,
  turn_completed: tone.completed.dot
}

export function SessionStatusIcon({
  status,
  size = 14,
  className
}: {
  status: SessionDisplayStatus
  size?: number
  className?: string
}) {
  if (status === "active") {
    return <Loader2 size={size} className={cn("animate-spin", tone.running.icon, className)} />
  }
  if (status === "idle") {
    return <CirclePause size={size} className={cn(tone.completed.icon, className)} />
  }
  if (status === "turn_completed") {
    return <CircleStop size={size} className={cn(tone.completed.icon, className)} />
  }
  if (status === "not_loaded") {
    return <CircleDotDashed size={size} className={cn(tone.stale.icon, className)} />
  }
  return <Circle size={size} className={cn(tone.error.icon, className)} />
}
