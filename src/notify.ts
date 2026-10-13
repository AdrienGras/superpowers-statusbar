import type { RunState, WaitReason } from '../types'

const NOTIFIED: ReadonlySet<WaitReason> = new Set<WaitReason>(['execution-choice', 'blocked', 'breaker', 'finishing-menu'])

/** The status-bar text for the current wait, empty when the run is not waiting. */
export function waitText(s: RunState): string {
  const w = s.waiting
  if (!w) return ''
  switch (w.reason) {
    case 'brainstorm-question': return 'question en cours'
    case 'spec-approval': return 'spec à valider'
    case 'execution-choice': return `plan prêt (${s.tasks.length} tâches) · choisis le mode d'exécution`
    case 'blocked': return `Task ${w.task ?? '?'} bloquée`
    case 'breaker': return `Task ${w.task ?? '?'} · 5 fix rounds épuisés`
    case 'finishing-menu': return 'prêt pour ton test · menu de fin de branche'
    case 'other': return 'à toi'
  }
}

/** The notification to raise when `next` enters a new wait worth interrupting for. */
export function notificationFor(prev: RunState | null, next: RunState | null): string | undefined {
  const w = next?.waiting
  if (!next || !w || !NOTIFIED.has(w.reason)) return undefined
  const before = prev?.waiting
  return !before || before.reason !== w.reason || before.since !== w.since ? waitText(next) : undefined
}
