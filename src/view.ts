import type { ReportedPhase, RunState, Stage, TaskEvent, TaskState } from '../types'
import { currentTask } from './reduce.ts'
import { waitText } from './notify.ts'

export type Tone = 'normal' | 'dim' | 'ok' | 'active' | 'todo' | 'wait' | 'accent'
export type Segment = { text: string; tone: Tone; isBold?: boolean }

export type PaneModel = {
  title: string
  elapsed?: string
  stages: { label: string; status: 'done' | 'active' | 'todo' | 'skipped'; detail?: string }[]
  tasks: { n: string; title: string; status: TaskState['status']; duration?: string; fixRounds: number }[]
  hiddenTasks: number
  current?: { n: string; trail: string[] }
  decisions: RunState['decisions']
  eta?: string
}

const BAR_CELLS = 15
const MAX_FIX_ROUNDS = 5
const STAGES: readonly Stage[] = ['brainstorm', 'plan', 'exec', 'final-review', 'finishing', 'done']
const PANE_CHROME_ROWS = 14
const MIN_TASK_ROWS = 3

const REPORTED_LABELS: Record<ReportedPhase, string> = {
  conversation: 'conversation',
  'design-writing': 'writing the spec',
  'builder-check': 'builder check',
  'awaiting-approval': 'spec awaiting approval',
  drafting: 'drafting',
  'self-review': 'plan self-review',
  red: 'RED',
  green: 'GREEN',
  refactor: 'refactor',
}

// --- formatting ---

export function formatDuration(ms: number): string {
  const minutes = Math.max(0, Math.floor(ms / 60000))
  if (minutes < 60) return `${minutes}m`
  return `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, '0')}`
}

export function formatClock(at: number): string {
  const d = new Date(at)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export function phaseLabel(e: TaskEvent): string {
  switch (e.phase) {
    case 'brief': return 'brief'
    case 'writing': return 'implementing'
    case 'review': return 'review'
    case 'fix': return `fix ${e.round ?? '?'}/${MAX_FIX_ROUNDS}`
    case 're-review': return `re-review ${e.round ?? '?'}`
    case 'red': return 'RED'
    case 'green': return 'GREEN'
    case 'refactor': return 'refactor'
    case 'verify': return 'verify'
    case 'done': return 'done'
    case 'unknown': return '?'
  }
}

export function stageLabel(s: RunState): string {
  switch (s.stage) {
    case 'brainstorm': return 'brainstorming'
    case 'plan': return 'plan'
    case 'exec': return s.mode === 'sdd' ? 'exec SDD' : s.mode === 'direct' ? 'exec inline' : 'exec'
    case 'final-review': return s.finalReview?.phase === 'fixes' ? 'final review · fixes' : 'final review'
    case 'finishing': return 'finishing'
    case 'done': return 'done'
  }
}

const planSlug = (planPath: string) =>
  (planPath.split('/').pop() ?? '').replace(/\.md$/, '').replace(/^\d{4}-\d{2}-\d{2}-/, '')

// --- estimate ---

export function estimate(s: RunState, now: number): { avgMs: number; remainingMs: number; finishAt: number } | undefined {
  const spans = s.tasks.flatMap(t =>
    t.status === 'done' && t.startedAt && t.doneAt ? [t.doneAt - t.startedAt] : [])
  const remaining = s.tasks.filter(t => t.status !== 'done').length
  if (spans.length === 0 || remaining === 0) return undefined
  const avgMs = spans.reduce((a, b) => a + b, 0) / spans.length
  const remainingMs = avgMs * remaining
  return { avgMs, remainingMs, finishAt: now + remainingMs }
}

// --- band ---

const sep = (text: string): Segment => ({ text, tone: 'dim' })
const elapsedOf = (s: RunState, now: number) => (s.startedAt ? formatDuration(now - s.startedAt) : undefined)

function doneBand(s: RunState, now: number): Segment[] {
  const fixRounds = s.tasks.reduce((n, t) => n + t.fixRounds, 0)
  const aside = s.decisions.filter(d => d.kind === 'parked' || d.kind === 'minor').length
  const end = s.finishedAt ?? now
  const parts = [`${s.tasks.length} tasks`, `${fixRounds} fix rounds`, `${aside} set aside`]
  const elapsed = s.startedAt ? formatDuration(end - s.startedAt) : undefined
  if (elapsed) parts.push(elapsed)
  return [{ text: '✓ done', tone: 'ok', isBold: true }, ...parts.flatMap(p => [sep(' · '), { text: p, tone: 'normal' as const }])]
}

type Parts = { isElapsed: boolean; isTitle: boolean; isBar: boolean }

function counterOf(s: RunState): number {
  const done = s.tasks.filter(t => t.status === 'done').length
  return Math.min(s.tasks.length, done + (currentTask(s) ? 1 : 0))
}

function execBand(s: RunState, now: number, parts: Parts): Segment[] {
  const total = s.tasks.length
  const done = s.tasks.filter(t => t.status === 'done').length
  const cur = currentTask(s)
  const filled = total ? Math.round((done / total) * BAR_CELLS) : 0
  const counter = counterOf(s)

  const head: Segment[] = [
    { text: '●', tone: 'active' }, sep(' '),
    { text: stageLabel(s), tone: 'normal' }, sep(' '),
  ]
  const bar: Segment[] = !parts.isBar ? [] : [
    { text: '▰'.repeat(filled), tone: 'ok' },
    { text: '▱'.repeat(BAR_CELLS - filled), tone: 'todo' },
    sep(' '),
  ]
  const tail: Segment[] = [{ text: `${counter}/${total}`, tone: 'normal', isBold: true }]
  const more: Segment[][] = []
  if (cur) {
    const last = cur.trail[cur.trail.length - 1]
    more.push([
      { text: `Task ${cur.n}`, tone: 'accent' },
      ...(parts.isTitle ? [{ text: ` « ${cur.title} »`, tone: 'accent' as const }] : []),
    ])
    more.push([{ text: last ? phaseLabel(last) : '?', tone: 'normal' }])
    if (cur.fixRounds > 0 && last?.phase !== 'fix') {
      more.push([{ text: `fix ${cur.fixRounds}/${MAX_FIX_ROUNDS}`, tone: 'normal' }])
    }
  }
  const elapsed = parts.isElapsed ? elapsedOf(s, now) : undefined
  if (elapsed) more.push([{ text: elapsed, tone: 'dim' }])
  return [...head, ...bar, ...tail, ...more.flatMap(m => [sep(' · '), ...m])]
}

function simpleBand(s: RunState, now: number): Segment[] {
  const out: Segment[] = [{ text: '●', tone: 'active' }, sep(' '), { text: stageLabel(s), tone: 'normal' }]
  let phase: string | undefined
  if (s.stagePhase) phase = REPORTED_LABELS[s.stagePhase]
  else if (s.stage === 'plan' && s.tasks.length > 0) phase = `${s.tasks.length} tasks`
  if (phase) out.push(sep(' · '), { text: phase, tone: 'normal' })
  if (s.stage !== 'brainstorm' && s.stage !== 'plan') {
    const elapsed = elapsedOf(s, now)
    if (elapsed) out.push(sep(' · '), { text: elapsed, tone: 'dim' })
  }
  return out
}

const length = (segs: Segment[]) => segs.reduce((n, g) => n + g.text.length, 0)

/** Drops, in order: elapsed time, task title, bar. Marker, stage and counter always stay. */
function fitExecBand(s: RunState, now: number, columns: number): Segment[] {
  const attempts: Parts[] = [
    { isElapsed: true, isTitle: true, isBar: true },
    { isElapsed: false, isTitle: true, isBar: true },
    { isElapsed: false, isTitle: false, isBar: true },
    { isElapsed: false, isTitle: false, isBar: false },
  ]
  let band: Segment[] = []
  for (const parts of attempts) {
    band = execBand(s, now, parts)
    if (length(band) <= columns) break
  }
  return band
}

function waitingBand(s: RunState, columns: number): Segment[] {
  const badge = 'WAITING '
  const message = waitText(s)
  const room = columns - badge.length
  const shown = message.length <= room ? message : `${message.slice(0, Math.max(0, room - 1))}…`
  const out: Segment[] = [{ text: 'WAITING', tone: 'wait', isBold: true }, sep(' '), { text: shown, tone: 'wait' }]
  const counter = `${counterOf(s)}/${s.tasks.length}`
  if (s.stage === 'exec' && shown === message && badge.length + message.length + 3 + counter.length <= columns) {
    out.push(sep(' · '), { text: counter, tone: 'normal', isBold: true })
  }
  return out
}

export function bandSegments(s: RunState, now: number, columns: number): Segment[] {
  if (s.stage === 'done') return doneBand(s, now)
  if (s.waiting) return waitingBand(s, columns)
  return s.stage === 'exec' ? fitExecBand(s, now, columns) : simpleBand(s, now)
}

// --- pane ---

function visibleWindow(total: number, rows: number, centre: number): { start: number; end: number } {
  const size = Math.min(total, Math.max(MIN_TASK_ROWS, rows - PANE_CHROME_ROWS))
  const start = Math.max(0, Math.min(total - size, centre - Math.floor(size / 2)))
  return { start, end: start + size }
}

function stagesOf(s: RunState): PaneModel['stages'] {
  const cur = STAGES.indexOf(s.stage)
  const done = s.tasks.filter(t => t.status === 'done').length
  return STAGES.map((stage, i) => {
    const label = stageLabel({ ...s, stage })
    if (i > cur) return { label, status: 'todo' as const }
    if (stage === 'done' || (i === cur && s.stage === 'done')) return { label, status: 'done' as const }
    if (i === cur) {
      const detail = stage === 'exec' ? `${done}/${s.tasks.length}`
        : s.stagePhase ? REPORTED_LABELS[s.stagePhase] : undefined
      return { label, status: 'active' as const, ...(detail ? { detail } : {}) }
    }
    const hasMilestone = s.milestones.some(m => m.stage === stage)
    // Only the early stages can be legitimately bypassed; later ones are always traversed.
    return { label, status: hasMilestone || i >= STAGES.indexOf('exec') ? 'done' as const : 'skipped' as const }
  })
}

export function paneModel(s: RunState, now: number, rows: number): PaneModel {
  const cur = currentTask(s)
  const curIndex = cur ? s.tasks.indexOf(cur) : Math.max(0, s.tasks.findIndex(t => t.status !== 'done'))
  const { start, end } = visibleWindow(s.tasks.length, rows, curIndex)
  const est = estimate(s, now)
  const elapsed = elapsedOf(s, now)
  return {
    title: s.planPath ? `superpowers · ${planSlug(s.planPath)}` : 'superpowers',
    ...(elapsed ? { elapsed } : {}),
    stages: stagesOf(s),
    tasks: s.tasks.slice(start, end).map(t => ({
      n: t.n, title: t.title, status: t.status, fixRounds: t.fixRounds,
      ...(t.status === 'done' && t.startedAt && t.doneAt ? { duration: formatDuration(t.doneAt - t.startedAt) } : {}),
    })),
    hiddenTasks: s.tasks.length - (end - start),
    ...(cur ? { current: { n: cur.n, trail: cur.trail.map(e => e.verdict ? `${phaseLabel(e)} (${e.verdict})` : phaseLabel(e)) } } : {}),
    decisions: s.decisions,
    ...(est ? { eta: `avg ${formatDuration(est.avgMs)}/task · ~${formatDuration(est.remainingMs)} left · ETA ${formatClock(est.finishAt)}` } : {}),
  }
}
