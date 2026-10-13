import type {
  Action, AgentRecord, Milestone, Mode, ReportedPhase, RunState, Stage, TaskEvent, TaskPhase, TaskState, Waiting,
} from '../types'
import { decisionsOf } from './ledger.ts'
import { isUncleanVerdict, parseReport } from './reports.ts'

type ActionOf<T extends Action['type']> = Extract<Action, { type: T }>

const STAGES: readonly Stage[] = ['brainstorm', 'plan', 'exec', 'final-review', 'finishing', 'done']
const rank = (stage: Stage) => STAGES.indexOf(stage)

const TASK_PHASES: ReadonlySet<ReportedPhase> = new Set<ReportedPhase>(['red', 'green', 'refactor'])
const PLAN_COUNT = / étapes$/

export function newRun(stage: Stage, at: number, mode?: Mode): RunState {
  return {
    id: `run-${at}`, startedAt: at, stage, ...(mode ? { mode } : {}),
    tasks: [], milestones: [], agents: {}, decisions: [],
  }
}

/** The active task started most recently; ties go to the latest trail activity, then to plan order. */
export function currentTask(s: RunState): TaskState | undefined {
  let best: TaskState | undefined
  for (const t of s.tasks) {
    if (t.status !== 'active') continue
    if (!best || compareRecency(t, best) >= 0) best = t
  }
  return best
}

function compareRecency(a: TaskState, b: TaskState): number {
  return (a.startedAt ?? 0) - (b.startedAt ?? 0) || lastActivity(a) - lastActivity(b)
}

const lastActivity = (t: TaskState) => t.trail[t.trail.length - 1]?.at ?? 0

// --- run helpers ---

function setStage(s: RunState, stage: Stage): RunState {
  if (stage === s.stage) return s
  const { stagePhase: _dropped, ...rest } = s
  return { ...rest, stage }
}

const advance = (s: RunState, stage: Stage) => (rank(stage) > rank(s.stage) ? setStage(s, stage) : s)

function addMilestone(s: RunState, m: Milestone, supersedes?: (old: Milestone) => boolean): RunState {
  if (s.milestones.some(o => o.stage === m.stage && o.label === m.label)) return s
  const kept = supersedes ? s.milestones.filter(o => !supersedes(o)) : s.milestones
  return { ...s, milestones: [...kept, m] }
}

function withExecMilestone(s: RunState, at: number): RunState {
  if (s.stage !== 'exec' || !s.mode || s.milestones.some(m => m.stage === 'exec')) return s
  return addMilestone(s, { stage: 'exec', label: s.mode === 'sdd' ? 'exec SDD' : 'exec direct', at })
}

const setAgent = (s: RunState, id: string, rec: AgentRecord): RunState => ({ ...s, agents: { ...s.agents, [id]: rec } })

// --- task helpers ---

const findTask = (s: RunState, n: string) => s.tasks.find(t => t.n === n)

function ensureTask(s: RunState, n: string): RunState {
  if (findTask(s, n)) return s
  return { ...s, tasks: [...s.tasks, { n, title: '?', steps: 0, status: 'todo', fixRounds: 0, trail: [] }] }
}

/** Applies `f` to task `n` if it exists. */
function mapTask(s: RunState, n: string, f: (t: TaskState) => TaskState): RunState {
  if (!findTask(s, n)) return s
  return { ...s, tasks: s.tasks.map(t => (t.n === n ? f(t) : t)) }
}

/** Applies `f` to task `n`, adding it with an unknown title when the plan lacks it. */
const upsertTask = (s: RunState, n: string, f: (t: TaskState) => TaskState) => mapTask(ensureTask(s, n), n, f)

const push = (t: TaskState, e: TaskEvent): TaskState => ({ ...t, trail: [...t.trail, e] })

const activate = (t: TaskState, at: number): TaskState => ({ ...t, status: 'active', startedAt: t.startedAt ?? at })

const finish = (t: TaskState, at: number): TaskState => ({ ...push(t, { phase: 'done', at }), status: 'done', doneAt: t.doneAt ?? at })

function fix(t: TaskState, at: number): TaskState {
  const round = t.fixRounds + 1
  return { ...push(t, { phase: 'fix', at, round }), fixRounds: round }
}

const isReview = (e: TaskEvent) => e.phase === 'review' || e.phase === 're-review'

const hasReview = (t: TaskState) => t.trail.some(isReview)

/** The latest review or re-review was not clean and no fix has started since. */
function needsFix(t: TaskState): boolean {
  for (let i = t.trail.length - 1; i >= 0; i--) {
    const e = t.trail[i]!
    if (e.phase === 'fix') return false
    if (isReview(e)) return isUncleanVerdict(e.verdict)
  }
  return false
}

function setLastVerdict(t: TaskState, phase: TaskPhase, verdict: string): { task: TaskState; event?: TaskEvent } {
  for (let i = t.trail.length - 1; i >= 0; i--) {
    const e = t.trail[i]!
    if (e.phase !== phase) continue
    const event = { ...e, verdict }
    return { task: { ...t, trail: t.trail.map((x, j) => (j === i ? event : x)) }, event }
  }
  return { task: t }
}

// --- reducer ---

export function reduce(s: RunState | null, a: Action): RunState | null {
  if (a.type === 'stage-entered') return stageEntered(s, a)
  if (!s) return null
  switch (a.type) {
    case 'phase-reported': return phaseReported(s, a)
    case 'spec-written':
      return addMilestone({ ...s, specPath: a.path }, { stage: 'brainstorm', label: 'spec écrite', at: a.at })
    case 'plan-loaded': return planLoaded(s, a)
    case 'workspace-found': return { ...s, workspace: a.path, planPath: a.planPath }
    case 'task-started':
      return upsertTask(s, a.task, t => push(activate(t, a.at), { phase: 'brief', at: a.at }))
    case 'agent-dispatched': {
      const pending = s.agents[a.agentId]?.pendingAnswer
      const next = agentDispatched(s, a)
      return pending === undefined ? next : agentReported(next, { type: 'agent-reported', agentId: a.agentId, answer: pending, at: a.at })
    }
    case 'agent-resumed': return agentResumed(s, a)
    case 'agent-reported': return agentReported(s, a)
    case 'task-verified':
      return upsertTask(s, a.task, t =>
        a.isOk ? finish(push(t, { phase: 'verify', at: a.at }), a.at) : push(t, { phase: 'verify', at: a.at, verdict: 'échec' }))
    case 'ledger-loaded': return ledgerLoaded(s, a)
    case 'workspace-removed':
      return s.stage === 'final-review' || s.stage === 'exec' ? { ...s, finalReview: { ...s.finalReview, phase: 'done' } } : s
    case 'branch-finished': return { ...setStage(s, 'done'), finishedAt: a.at }
    case 'turn-started': {
      if (!s.waiting) return s
      const { waiting: _cleared, ...rest } = s
      return rest
    }
    case 'turn-ended': return turnEnded(s, a)
  }
}

function waitFor(s: RunState): Pick<Waiting, 'reason' | 'task'> | undefined {
  switch (s.stage) {
    case 'brainstorm': return { reason: s.stagePhase === 'awaiting-approval' ? 'spec-approval' : 'brainstorm-question' }
    case 'plan': return { reason: s.tasks.length > 0 ? 'execution-choice' : 'other' }
    case 'exec': {
      const t = currentTask(s)
      if (t?.isBreakerTripped) return { reason: 'breaker', task: t.n }
      if (t?.lastStatus === 'BLOCKED') return { reason: 'blocked', task: t.n }
      return { reason: 'other' }
    }
    case 'final-review': return { reason: 'other' }
    case 'finishing': return { reason: 'finishing-menu' }
    case 'done': return undefined
  }
}

/** A main-loop turn ended: the run waits for Adrien unless a background agent is still working. */
function turnEnded(s: RunState, a: ActionOf<'turn-ended'>): RunState {
  const { waiting: _previous, ...rest } = s
  if (Object.values(s.agents).some(r => r.isRunning)) return rest
  const w = waitFor(s)
  return w ? { ...rest, waiting: { ...w, since: a.at } } : rest
}

function stageEntered(s: RunState | null, a: ActionOf<'stage-entered'>): RunState {
  if (!s || s.stage === 'done' || rank(a.stage) < rank(s.stage)) return withExecMilestone(newRun(a.stage, a.at, a.mode), a.at)
  const next = advance(s, a.stage)
  return withExecMilestone(a.mode ? { ...next, mode: a.mode } : next, a.at)
}

function phaseReported(s: RunState, a: ActionOf<'phase-reported'>): RunState {
  if (TASK_PHASES.has(a.phase)) {
    const agentTask = a.agentId ? s.agents[a.agentId]?.task : undefined
    const n = agentTask && findTask(s, agentTask) ? agentTask : currentTask(s)?.n
    return n ? mapTask(s, n, t => push(t, { phase: a.phase as TaskPhase, at: a.at })) : s
  }
  const next = { ...s, stagePhase: a.phase }
  if (a.phase === 'builder-check') return addMilestone(next, { stage: 'brainstorm', label: 'builder check', at: a.at })
  if (a.phase === 'awaiting-approval') return addMilestone(next, { stage: 'brainstorm', label: 'spec à valider', at: a.at })
  return next
}

function planLoaded(s: RunState, a: ActionOf<'plan-loaded'>): RunState {
  const tasks = a.tasks.map((p): TaskState => {
    const old = findTask(s, p.n)
    if (old && old.status !== 'todo') return { ...old, title: p.title, steps: p.steps }
    return { ...p, status: 'todo', fixRounds: 0, trail: [] }
  })
  const steps = a.tasks.reduce((sum, t) => sum + t.steps, 0)
  const next = { ...(s.stage === 'brainstorm' ? setStage(s, 'plan') : s), planPath: a.path, tasks }
  return addMilestone(
    next,
    { stage: 'plan', label: `${a.tasks.length} tâches · ${steps} étapes`, at: a.at },
    m => m.stage === 'plan' && PLAN_COUNT.test(m.label),
  )
}

function agentDispatched(s: RunState, a: ActionOf<'agent-dispatched'>): RunState {
  const record = (task?: string): AgentRecord => ({
    role: a.role, isRunning: a.isRunning,
    ...(task !== undefined ? { task } : {}),
    ...(a.round !== undefined ? { round: a.round } : {}),
  })
  const n = a.task ?? currentTask(s)?.n
  switch (a.role) {
    case 'implementer':
      if (!n) return setAgent(s, a.agentId, record())
      return setAgent(upsertTask(s, n, t => {
        const active = activate(t, a.at)
        const next = hasReview(t) ? fix(active, a.at) : push(active, { phase: 'writing', at: a.at })
        return { ...next, implementerId: a.agentId }
      }), a.agentId, record(n))
    case 'reviewer':
      if (!n) return setAgent(s, a.agentId, record())
      return setAgent(upsertTask(s, n, t => push(t, { phase: 'review', at: a.at })), a.agentId, record(n))
    case 're-reviewer':
      if (!n) return setAgent(s, a.agentId, record())
      return setAgent(
        upsertTask(s, n, t => push(t, { phase: 're-review', at: a.at, round: a.round ?? t.fixRounds })),
        a.agentId, record(n))
    case 'final-reviewer':
      return setAgent({ ...advance(s, 'final-review'), finalReview: { phase: 'review' } }, a.agentId, record(a.task))
    case 'builder-check':
      return setAgent(addMilestone(s, { stage: 'brainstorm', label: 'builder check', at: a.at }), a.agentId, record(a.task))
    case 'other': {
      const fr = s.finalReview
      if (s.stage === 'final-review' && fr?.phase === 'review' && isUncleanVerdict(fr.verdict)) {
        return setAgent({ ...s, finalReview: { ...fr, phase: 'fixes' } }, a.agentId, record(a.task))
      }
      const cur = currentTask(s)
      if (cur && needsFix(cur)) return setAgent(mapTask(s, cur.n, t => fix(t, a.at)), a.agentId, record(cur.n))
      return setAgent(s, a.agentId, record(a.task))
    }
    case 'unknown':
      return setAgent(s, a.agentId, record(a.task))
  }
}

function agentResumed(s: RunState, a: ActionOf<'agent-resumed'>): RunState {
  const rec = s.agents[a.agentId]
  if (!rec) return s
  const next = setAgent(s, a.agentId, { ...rec, isRunning: true })
  const t = next.tasks.find(x => x.implementerId === a.agentId)
  return t && needsFix(t) ? mapTask(next, t.n, x => fix(x, a.at)) : next
}

function agentReported(s: RunState, a: ActionOf<'agent-reported'>): RunState {
  const rec = s.agents[a.agentId]
  if (!rec || rec.role === 'unknown') {
    return setAgent(s, a.agentId, { role: 'unknown', isRunning: false, pendingAnswer: a.answer })
  }
  const next = setAgent(s, a.agentId, { ...rec, isRunning: false })
  const r = parseReport(rec.role, a.answer)
  const n = rec.task
  switch (rec.role) {
    case 'implementer': {
      const status = r.status
      return status && n ? mapTask(next, n, t => ({ ...t, lastStatus: status })) : next
    }
    case 'reviewer':
    case 're-reviewer': {
      const verdict = r.verdict
      if (!verdict || !n) return next
      return mapTask(next, n, t => {
        const { task, event } = setLastVerdict(t, rec.role === 'reviewer' ? 'review' : 're-review', verdict)
        const isBreaker = rec.role === 're-reviewer' && r.isClean === false && (event?.round ?? 0) >= 5
        return isBreaker ? { ...task, isBreakerTripped: true } : task
      })
    }
    case 'final-reviewer': {
      if (!r.verdict) return next
      const phase = r.isClean ? 'done' : next.mode === 'sdd' ? 'review' : 'fixes'
      return { ...next, finalReview: { ...next.finalReview, phase, verdict: r.verdict } }
    }
    default:
      return next
  }
}

function ledgerLoaded(s: RunState, a: ActionOf<'ledger-loaded'>): RunState {
  const tasks = s.tasks.map(t => {
    let u = t
    for (const l of a.lines) {
      if (l.kind === 'complete' && l.task === t.n && u.status !== 'done') u = finish(u, a.at)
      if (l.kind === 'fix-round' && l.task === t.n && l.round > u.fixRounds) u = { ...u, fixRounds: l.round }
    }
    return u
  })
  return { ...s, tasks, decisions: decisionsOf(a.lines) }
}
