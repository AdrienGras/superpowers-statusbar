import type { RunState, TaskState } from '../types'

// Which task a run is on: pure reads of a RunState, shared by the reducer, the detectors and the views.

export const findTask = (s: RunState, n: string): TaskState | undefined => s.tasks.find(t => t.n === n)

/** The active task activated most recently; ties go to the latest trail activity, then to plan order. */
export function currentTask(s: RunState): TaskState | undefined {
  let best: TaskState | undefined
  for (const t of s.tasks) {
    if (t.status !== 'active') continue
    if (!best || compareRecency(t, best) >= 0) best = t
  }
  return best
}

function compareRecency(a: TaskState, b: TaskState): number {
  return (a.activeAt ?? a.startedAt ?? 0) - (b.activeAt ?? b.startedAt ?? 0) || lastActivity(a) - lastActivity(b)
}

const lastActivity = (t: TaskState) => t.trail[t.trail.length - 1]?.at ?? 0

/**
 * The task whose TDD work an agent does: with `agentId`, the task of an implementer; without, the current task of an
 * inline run in exec. Reviewers and every other agent do no TDD work of their own.
 */
export function tddTask(s: RunState, agentId?: string): TaskState | undefined {
  if (agentId !== undefined) {
    const rec = s.agents[agentId]
    return rec?.role === 'implementer' && rec.task ? findTask(s, rec.task) : undefined
  }
  return s.mode === 'direct' && s.stage === 'exec' ? currentTask(s) : undefined
}
