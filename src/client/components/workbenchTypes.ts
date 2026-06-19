import type { ControlThread, RuntimeStatus } from "../../server/domain.js"

export type DateBucket = "Today" | "Yesterday" | "Older"
export type ComposerMode = "thread" | "new"

export type ProjectAccent = "emerald" | "violet" | "sky"

export type WorkbenchSession = {
  id: string
  threadId: string | null
  title: string
  preview: string
  cwd: string
  model: string | null
  status: RuntimeStatus
  tokensUsed: number
  updatedAt: string
  dateBucket: DateBucket
  mock: boolean
  thread: ControlThread | null
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

export type RuntimeEnvironment = "Python" | "Node" | "Bash"

export type ParameterState = {
  model: string
  runtime: RuntimeEnvironment
  temperature: number
  maxTokens: number
  reasoning: number
  autoRun: boolean
}
