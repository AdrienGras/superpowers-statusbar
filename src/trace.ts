import type { Action, RunState, TaskState, TraceEntry } from '../types'
import { currentTask } from './reduce.ts'

/** The task `a` is about: the one it names, or its agent's, when the run has it. */
function namedTask(a: Action, s: RunState): TaskState | undefined {
  const n = 'task' in a ? a.task : 'agentId' in a && a.agentId ? s.agents[a.agentId]?.task : undefined
  return n === undefined ? undefined : s.tasks.find(t => t.n === n)
}

/** One line of the run's trace: the action and the run as it stands after it. */
export function traceEntry(a: Action, s: RunState | null): TraceEntry {
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
  if (s.waiting) entry.waiting = s.waiting.reason
  return entry
}
