import type { Mode, Stage, TaskPhase, TraceEntry } from '../types'

const STAGES: readonly Stage[] = ['exec', 'final-review']

/** What a trace says about the mod (`errors`) and about the model's flow, which the mod does not control (`warnings`). */
export type TraceCheck = { errors: string[]; warnings: string[] }

/** Whether `wanted` appears in `seq` in this order, other items allowed in between. */
function inOrder<T>(seq: readonly T[], wanted: readonly T[]): boolean {
  let i = 0
  for (const x of seq) if (i < wanted.length && x === wanted[i]) i++
  return i === wanted.length
}

/**
 * Checks a trace written by the mod during a real run of the e2e plan (`SP_STATUSBAR_TRACE`). Only order and
 * presence count, never how many entries there are. Errors: the stages exec then final-review, and finishing after
 * final-review when the run reached it; `expectedTasks`
 * distinct tasks reaching `done`; in `sdd`, each done task through `writing` then `review`; in `direct`, each done
 * task through `verify`; once the run reached finishing, a last entry waiting on the finishing menu. Warnings: in
 * `direct`, no task through `red` then `green`; a run that never reached finishing. Task phases come from the
 * entries' `phases`. The finishing warning is worded as the controller ruled.
 */
export function checkTrace(entries: readonly TraceEntry[], mode: Mode, expectedTasks: number): TraceCheck {
  const errors: string[] = []
  const warnings: string[] = []

  let from = 0
  let isInOrder = true
  for (const [k, stage] of STAGES.entries()) {
    const i = entries.findIndex((e, j) => j >= from && e.stage === stage)
    if (i < 0) {
      errors.push(k === 0 ? `stage ${stage} missing` : `stage ${stage} missing after ${STAGES[k - 1]}`)
      isInOrder = false
      break
    }
    from = i
  }
  const isFinishingReached = entries.some(e => e.stage === 'finishing')
  if (isInOrder && isFinishingReached && !entries.some((e, j) => j >= from && e.stage === 'finishing')) {
    errors.push('stage finishing missing after final-review')
  }

  const trails = new Map<string, TaskPhase[]>()
  for (const e of entries) {
    for (const p of e.phases ?? []) trails.set(p.task, [...(trails.get(p.task) ?? []), p.phase])
  }
  const done = [...trails].filter(([, trail]) => trail.includes('done'))
  if (done.length !== expectedTasks) errors.push(`${done.length} task(s) done out of ${expectedTasks} expected`)
  for (const [task, trail] of done) {
    if (mode === 'sdd' && !inOrder(trail, ['writing', 'review', 'done'])) errors.push(`task ${task}: no writing then review before done`)
    if (mode === 'direct' && !inOrder(trail, ['verify', 'done'])) errors.push(`task ${task}: no verify before done`)
  }
  if (mode === 'direct' && ![...trails.values()].some(trail => inOrder(trail, ['red', 'green']))) {
    warnings.push('no task goes through red then green')
  }

  // A dispatch observed at `agent.spawn` is the normal path in SDD; only the `tool.call` fallback means the engine did not show spawns.
  const dispatches = entries.filter(e => e.action === 'agent-dispatched')
  if (mode === 'sdd' && dispatches.length > 0 && dispatches.every(e => e.via === 'tool')) {
    warnings.push('no dispatch seen at agent.spawn (tool.call fallback only)')
  }

  if (isFinishingReached) {
    const last = entries[entries.length - 1]
    if (last?.waiting !== 'finishing-menu') {
      errors.push(`the last entry does not wait on finishing-menu (${last?.waiting ?? 'no wait'})`)
    }
  } else {
    warnings.push('run never reached finishing (model behaviour)')
  }
  return { errors, warnings }
}
