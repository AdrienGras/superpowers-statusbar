import type { Mode, Stage, TaskPhase, TraceEntry } from '../types'

const STAGES: readonly Stage[] = ['exec', 'final-review', 'finishing']

/** Whether `wanted` appears in `seq` in this order, other items allowed in between. */
function inOrder<T>(seq: readonly T[], wanted: readonly T[]): boolean {
  let i = 0
  for (const x of seq) if (i < wanted.length && x === wanted[i]) i++
  return i === wanted.length
}

/**
 * Checks a trace written by the mod during a real run of the e2e plan (`SP_STATUSBAR_TRACE`). Only order and
 * presence count, never how many entries there are: the stages exec, final-review and finishing in that order;
 * `expectedTasks` distinct tasks reaching `done`; in `sdd`, each done task through `writing` then `review`; in
 * `direct`, each done task through `verify`, and at least one through `red` then `green`; a last entry waiting on
 * the finishing menu. Task phases come from the entries' `phases`. Returns the problems, in French; none means OK.
 */
export function checkTrace(entries: readonly TraceEntry[], mode: Mode, expectedTasks: number): string[] {
  const problems: string[] = []

  let from = 0
  for (const [k, stage] of STAGES.entries()) {
    const i = entries.findIndex((e, j) => j >= from && e.stage === stage)
    if (i < 0) {
      problems.push(k === 0 ? `étape ${stage} absente` : `étape ${stage} absente après ${STAGES[k - 1]}`)
      break
    }
    from = i
  }

  const trails = new Map<string, TaskPhase[]>()
  for (const e of entries) {
    for (const p of e.phases ?? []) trails.set(p.task, [...(trails.get(p.task) ?? []), p.phase])
  }
  const done = [...trails].filter(([, trail]) => trail.includes('done'))
  if (done.length !== expectedTasks) problems.push(`${done.length} tâche(s) terminée(s) sur ${expectedTasks} attendue(s)`)
  for (const [task, trail] of done) {
    if (mode === 'sdd' && !inOrder(trail, ['writing', 'review', 'done'])) problems.push(`tâche ${task} : pas de writing puis review avant done`)
    if (mode === 'direct' && !inOrder(trail, ['verify', 'done'])) problems.push(`tâche ${task} : pas de verify avant done`)
  }
  if (mode === 'direct' && ![...trails.values()].some(trail => inOrder(trail, ['red', 'green']))) {
    problems.push('aucune tâche ne passe par red puis green')
  }

  const last = entries[entries.length - 1]
  if (last?.waiting !== 'finishing-menu') {
    problems.push(`la dernière entrée n'attend pas finishing-menu (${last ? (last.waiting ?? 'aucune attente') : 'trace vide'})`)
  }
  return problems
}
