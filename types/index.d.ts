export type Stage = 'brainstorm' | 'plan' | 'exec' | 'final-review' | 'finishing' | 'done'
export type Mode = 'sdd' | 'direct'
export type ReportedPhase =
  | 'conversation' | 'design-writing' | 'builder-check' | 'awaiting-approval'
  | 'drafting' | 'self-review'
  | 'red' | 'green' | 'refactor'
export type TaskPhase =
  | 'brief' | 'writing' | 'review' | 'fix' | 're-review'
  | 'red' | 'green' | 'refactor' | 'verify' | 'done' | 'unknown'
export type ImplementerStatus = 'DONE' | 'DONE_WITH_CONCERNS' | 'BLOCKED' | 'NEEDS_CONTEXT'
export type PlanTask = { n: string; title: string; steps: number; runs?: string[] }
export type TaskEvent = { phase: TaskPhase; at: number; round?: number; verdict?: string }
export type TaskState = PlanTask & {
  status: 'todo' | 'active' | 'done'
  startedAt?: number; doneAt?: number
  fixRounds: number; trail: TaskEvent[]
  /** When the task was last activated (its implementer dispatched or its script run); `startedAt` is the first time. */
  activeAt?: number
  implementerId?: string; lastStatus?: ImplementerStatus; isBreakerTripped?: boolean
}
export type AgentRoleName = 'implementer' | 'reviewer' | 're-reviewer' | 'final-reviewer' | 'builder-check' | 'other' | 'unknown'
export type AgentRecord = { role: AgentRoleName; task?: string; round?: number; isRunning: boolean; pendingAnswer?: string }
export type WaitReason = 'brainstorm-question' | 'spec-approval' | 'execution-choice' | 'blocked' | 'breaker' | 'finishing-menu' | 'other'
export type Waiting = { reason: WaitReason; task?: string; since: number }
export type Decision = { kind: 'ruling' | 'minor' | 'parked'; task?: string; text: string }
export type Milestone = { stage: Stage; label: string; at: number; kind?: 'plan-count' }
export type FinalReview = { phase: 'review' | 'fixes' | 'done'; verdict?: string }
export type RunState = {
  id: string; startedAt: number; stage: Stage; stagePhase?: ReportedPhase
  /** When each stage the run went through was entered; absent on a run stored before it was recorded. */
  stageStartedAt?: Partial<Record<Stage, number>>
  mode?: Mode; specPath?: string; planPath?: string; workspace?: string
  tasks: TaskState[]; milestones: Milestone[]
  agents: Record<string, AgentRecord>
  waiting?: Waiting; decisions: Decision[]
  finalReview?: FinalReview; finishedAt?: number
  /** A plan was read and listed tasks: until then the tasks are only those the scripts started, their total unknown. */
  isPlanLoaded?: boolean
  /**
   * In finishing, a turn started while the run waited on the finishing menu: the person answered it. Later turn ends
   * then wait on the person (`other`); the run ends only on a finishing command or the keep report.
   */
  isMenuAnswered?: boolean
}
export type LedgerLine =
  | { kind: 'complete'; task: string }
  | { kind: 'fix-round'; task: string; round: number }
  | { kind: 'minor'; task?: string; text: string }
  | { kind: 'parked'; task: string; text: string }
  | { kind: 'ruling'; task?: string; text: string }
export type ObservedEvent =
  | { kind: 'skill'; skill: string; agentId?: string; at: number }
  | { kind: 'command'; command: string; at: number }
  | { kind: 'tool'; tool: string; input: Record<string, unknown>; text?: string; result?: unknown; isError?: boolean; agentId?: string; at: number }
  | { kind: 'spawn'; agentId: string; description: string; prompt: string; parentAgentId?: string; at: number }
  | { kind: 'turn-start'; at: number }
  | { kind: 'turn-end'; agentId?: string; answer: string; at: number }
  | { kind: 'file'; role: 'plan' | 'ledger'; path: string; text: string; at: number }
export type FileRequest = { role: 'plan' | 'ledger'; path: string }
export type Action =
  | { type: 'stage-entered'; stage: Stage; mode?: Mode; agentId?: string; at: number }
  | { type: 'phase-reported'; phase: ReportedPhase; agentId?: string; at: number }
  | { type: 'spec-written'; path: string; at: number }
  | { type: 'plan-loaded'; path: string; tasks: PlanTask[]; at: number }
  | { type: 'workspace-found'; path: string; planPath: string; at: number }
  | { type: 'task-started'; task: string; at: number }
  | { type: 'agent-dispatched'; agentId: string; role: AgentRoleName; task?: string; round?: number; isRunning: boolean; at: number }
  | { type: 'agent-resumed'; agentId: string; at: number }
  | { type: 'agent-reported'; agentId: string; answer: string; at: number }
  | { type: 'task-verified'; task: string; isOk: boolean; at: number }
  | { type: 'ledger-loaded'; lines: LedgerLine[]; at: number }
  | { type: 'workspace-removed'; at: number }
  | { type: 'branch-finished'; at: number }
  | { type: 'turn-started'; at: number }
  | { type: 'turn-ended'; at: number }
export type Detection = { actions: Action[]; reads: FileRequest[] }
/** `phases`: the task events the action added, in order, across tasks (its `phase` only shows the last one of its task). */
export type TraceEntry = {
  at: number; action: Action['type']; stage?: Stage; mode?: Mode; task?: string; phase?: TaskPhase; waiting?: WaitReason
  phases?: { task: string; phase: TaskPhase }[]
  /** The kind of observed event that produced the action. */
  via?: ObservedEvent['kind']
}

declare module 'claude-code' {
  interface PluginState {
    'superpowers-statusbar': { run: RunState | null; isPaneOpen: boolean }
  }
}
