import type { RunState, WaitReason } from '../types'

const NOTIFIED: ReadonlySet<WaitReason> = new Set<WaitReason>(['execution-choice', 'blocked', 'breaker', 'finishing-menu'])

/** The status-bar text for the current wait, empty when the run is not waiting. */
export function waitText(s: RunState): string {
  const w = s.waiting
  if (!w) return ''
  switch (w.reason) {
    case 'brainstorm-question': return 'question for you'
    case 'spec-approval': return 'review the spec'
    case 'execution-choice': return `plan ready (${s.tasks.length} tasks) · pick an execution mode`
    case 'blocked': return `Task ${w.task ?? '?'} blocked`
    case 'breaker': return `Task ${w.task ?? '?'} · 5 fix rounds used up`
    case 'finishing-menu': return 'ready for your test · finishing menu'
    case 'other': return 'your turn'
  }
}

/** The notification to raise when `next` enters a new wait worth interrupting for. */
export function notificationFor(prev: RunState | null, next: RunState | null): string | undefined {
  const w = next?.waiting
  if (!next || !w || !NOTIFIED.has(w.reason)) return undefined
  const before = prev?.waiting
  return !before || before.reason !== w.reason || before.since !== w.since ? waitText(next) : undefined
}
