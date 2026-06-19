import type { ControlThread, GoalStatus, RuntimeStatus } from "../../server/domain.js"

export type DateBucket = "Today" | "Yesterday" | "Older"
export type ComposerMode = "thread" | "new"

export type ProjectAccent = "emerald" | "violet" | "sky" | "slate"

export type WorkbenchSession = {
  id: string
  threadId: string
  sessionId: string
  forkedFromId: string | null
  title: string
  preview: string
  cwd: string
  model: string | null
  status: RuntimeStatus
  activeTurnId: string | null
  goalObjective: string | null
  goalStatus: GoalStatus | null
  goalTokenBudget: number | null
  tokensUsed: number
  createdAt: string
  updatedAt: string
  dateBucket: DateBucket
  thread: ControlThread
}

export type WorkbenchProject = {
  id: string
  name: string
  path: string
  initials: string
  accent: ProjectAccent
  sessions: WorkbenchSession[]
  totalSessions: number
  runningSessions: number
  tokenTotal: number
}
