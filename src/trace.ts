import type { Action, RunState, TaskPhase, TaskState, TraceEntry } from '../types'
import { currentTask } from './reduce.ts'

/** The task `a` is about: the one it names, or its agent's, when the run has it. */
function namedTask(a: Action, s: RunState): TaskState | undefined {
  const n = 'task' in a ? a.task : 'agentId' in a && a.agentId ? s.agents[a.agentId]?.task : undefined
  return n === undefined ? undefined : s.tasks.find(t => t.n === n)
}

/** The task events `s` has that `prev` had not, in task order then trail order. Trails only grow or reset. */
function addedPhases(s: RunState, prev: RunState | null): { task: string; phase: TaskPhase }[] {
  return s.tasks.flatMap(t => {
    const before = prev?.tasks.find(p => p.n === t.n)?.trail.length ?? 0
    return t.trail.slice(before).map(e => ({ task: t.n, phase: e.phase }))
  })
}

/**
 * One line of the run's trace: the action and the run as it stands after it. Given the run before the action,
 * it also lists the task events the action added (`phases`), which the last `phase` alone can hide.
 */
export function traceEntry(a: Action, s: RunState | null, prev?: RunState | null): TraceEntry {
  const entry: TraceEntry = { at: a.at, action: a.type }
  if (!s) return entry
  entry.stage = s.stage
  if (s.mode) entry.mode = s.mode
  const t = namedTask(a, s) ?? currentTask(s)
  if (t) {
    entry.task = t.n
    const last = t.trail[t.trail.length - 1]
    if (last) entry.phase = last.phase
  }
  if (a.type === 'phase-reported') entry.reported = a.phase
  if (s.waiting) entry.waiting = s.waiting.reason
  if (prev !== undefined) {
    const phases = addedPhases(s, prev)
    if (phases.length > 0) entry.phases = phases
  }
  return entry
}
