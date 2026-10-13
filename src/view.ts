import type { ReportedPhase, RunState, Stage, TaskEvent, TaskPhase, TaskState } from '../types'
import { currentTask } from './reduce.ts'
import { waitText } from './notify.ts'

/**
 * What a piece of text means, which the render hooks turn into the theme's colours: `ok` done, `active` under way,
 * `subtle` secondary (durations, separators, verdicts, tags), `wait` the highlighted waiting block.
 */
export type Tone = 'normal' | 'subtle' | 'ok' | 'active' | 'wait'
/** `isSpinner`: the mark of something running, which a surface that can animates in place of its text. */
export type Segment = { text: string; tone: Tone; isBold?: boolean; isSpinner?: boolean }

/** Where a stage, task or task phase stands. */
export type Mark = 'done' | 'active' | 'todo' | 'skipped'

export type PaneModel = {
  title: string
  elapsed?: string
  /** `duration` once the stage is finished and its span known; `milestones` under brainstorm and plan only. */
  stages: { label: string; status: Mark; detail?: string; duration?: string; milestones: string[] }[]
  tasks: { n: string; title: string; status: TaskState['status']; duration?: string; fixRounds: number }[]
  hiddenTasks: number
  /** The current task's phases passed (`done`), under way (`active`) and still expected (`todo`), in order. */
  current?: { n: string; title: string; trail: { label: string; status: Exclude<Mark, 'skipped'>; verdict?: string }[] }
  decisions: RunState['decisions']
  eta?: string
}

const BAR_CELLS = 15
const MAX_FIX_ROUNDS = 5
const STAGES: readonly Stage[] = ['brainstorm', 'plan', 'exec', 'final-review', 'finishing', 'done']
/** Rows the pane spends beside the task list, before milestones and the current task's trail. */
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

const sep = (text: string): Segment => ({ text, tone: 'subtle' })
/** The band's lead while the run works. */
const RUNNING: Segment = { text: '●', tone: 'active', isSpinner: true }
const elapsedOf = (s: RunState, now: number) => (s.startedAt ? formatDuration(now - s.startedAt) : undefined)

function doneBand(s: RunState, now: number): Segment[] {
  const fixRounds = s.tasks.reduce((n, t) => n + t.fixRounds, 0)
  const aside = s.decisions.filter(d => d.kind === 'parked' || d.kind === 'minor').length
  const end = s.finishedAt ?? now
  const parts = [`${s.tasks.length} tasks`, `${fixRounds} fix rounds`, `${aside} set aside`]
  const elapsed = s.startedAt ? formatDuration(end - s.startedAt) : undefined
  const tail: Segment[] = elapsed ? [sep(' · '), { text: elapsed, tone: 'subtle' }] : []
  return [{ text: '✓ done', tone: 'ok', isBold: true }, ...parts.flatMap(p => [sep(' · '), { text: p, tone: 'normal' as const }]), ...tail]
}

type Parts = { isElapsed: boolean; isTitle: boolean; isBar: boolean }

function counterOf(s: RunState): number {
  const done = s.tasks.filter(t => t.status === 'done').length
  return Math.min(s.tasks.length, done + (currentTask(s) ? 1 : 0))
}

/** How many tasks the run has: `?` until a plan was read, the tasks then being only those already started. */
const totalOf = (s: RunState) => (s.isPlanLoaded ? String(s.tasks.length) : '?')

function execBand(s: RunState, now: number, parts: Parts): Segment[] {
  const total = s.tasks.length
  const done = s.tasks.filter(t => t.status === 'done').length
  const cur = currentTask(s)
  const filled = total ? Math.floor((done / total) * BAR_CELLS) : 0
  const counter = counterOf(s)

  const head: Segment[] = [
    RUNNING, sep(' '),
    { text: stageLabel(s), tone: 'normal' }, sep(' '),
  ]
  const bar: Segment[] = !parts.isBar || !s.isPlanLoaded ? [] : [
    { text: '▰'.repeat(filled), tone: 'ok' },
    { text: '▱'.repeat(BAR_CELLS - filled), tone: 'normal' },
    sep(' '),
  ]
  const tail: Segment[] = [{ text: `${counter}/${totalOf(s)}`, tone: 'normal', isBold: true }]
  const more: Segment[][] = []
  if (cur) {
    const last = cur.trail[cur.trail.length - 1]
    more.push([
      { text: `Task ${cur.n}`, tone: 'normal' },
      ...(parts.isTitle ? [{ text: `: ${cur.title}`, tone: 'normal' as const }] : []),
    ])
    more.push([{ text: last ? phaseLabel(last) : '?', tone: 'normal' }])
    if (cur.fixRounds > 0 && last?.phase !== 'fix') {
      more.push([{ text: `fix ${cur.fixRounds}/${MAX_FIX_ROUNDS}`, tone: 'normal' }])
    }
  }
  const elapsed = parts.isElapsed ? elapsedOf(s, now) : undefined
  if (elapsed) more.push([{ text: elapsed, tone: 'subtle' }])
  return [...head, ...bar, ...tail, ...more.flatMap(m => [sep(' · '), ...m])]
}

function simpleBand(s: RunState, now: number): Segment[] {
  const out: Segment[] = [RUNNING, sep(' '), { text: stageLabel(s), tone: 'normal' }]
  let phase: string | undefined
  if (s.stagePhase) phase = REPORTED_LABELS[s.stagePhase]
  else if (s.stage === 'plan' && s.tasks.length > 0) phase = `${s.tasks.length} tasks`
  if (phase) out.push(sep(' · '), { text: phase, tone: 'normal' })
  if (s.stage !== 'brainstorm' && s.stage !== 'plan') {
    const elapsed = elapsedOf(s, now)
    if (elapsed) out.push(sep(' · '), { text: elapsed, tone: 'subtle' })
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

/** The waiting block's text around the reason: ` WAITING · <reason> `, all of it highlighted. */
const WAIT_BADGE = 'WAITING'
const WAIT_CHROME = ` ${WAIT_BADGE} ·  `.length

/**
 * One highlighted block, ` WAITING · <reason> `, its spaces included, the reason cut with `…` to fit; in exec, the
 * counter follows outside the block when the whole reason and the counter fit.
 */
function waitingBand(s: RunState, columns: number): Segment[] {
  const message = waitText(s)
  const room = columns - WAIT_CHROME
  const shown = message.length <= room ? message : `${message.slice(0, Math.max(0, room - 1))}…`
  const out: Segment[] = [
    { text: ' ', tone: 'wait' },
    { text: WAIT_BADGE, tone: 'wait', isBold: true },
    { text: ` · ${shown} `, tone: 'wait' },
  ]
  const counter = `${counterOf(s)}/${totalOf(s)}`
  if (s.stage === 'exec' && shown === message && WAIT_CHROME + message.length + 3 + counter.length <= columns) {
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

/** The phases a task is expected to go through, by mode; fix and re-review rounds are shown as they happen. */
const SDD_PHASES: readonly TaskPhase[] = ['brief', 'writing', 'review', 'done']
const INLINE_PHASES: readonly TaskPhase[] = ['brief', 'red', 'green', 'refactor', 'verify', 'done']
/** Where a phase outside the SDD sequence stands in it: TDD steps inside implementing, fix rounds inside review. */
const SDD_PLACE: Partial<Record<TaskPhase, TaskPhase>> = { red: 'writing', green: 'writing', refactor: 'writing', fix: 'review', 're-review': 'review' }
const MILESTONE_STAGES: ReadonlySet<Stage> = new Set<Stage>(['brainstorm', 'plan'])

/** The tasks shown: `taskRows` of them (at least MIN_TASK_ROWS) around `centre`. */
function visibleWindow(total: number, taskRows: number, centre: number): { start: number; end: number } {
  const size = Math.min(total, Math.max(MIN_TASK_ROWS, taskRows))
  const start = Math.max(0, Math.min(total - size, centre - Math.floor(size / 2)))
  return { start, end: start + size }
}

/** How long `stage` lasted: from its start to the start of the next stage the run entered; unknown when either is. */
function stageDuration(s: RunState, i: number): string | undefined {
  const starts = s.stageStartedAt ?? {}
  const from = starts[STAGES[i]!]
  const to = STAGES.slice(i + 1).map(stage => starts[stage]).find(at => at !== undefined)
  return from && to ? formatDuration(to - from) : undefined
}

function stagesOf(s: RunState): PaneModel['stages'] {
  const cur = STAGES.indexOf(s.stage)
  const done = s.tasks.filter(t => t.status === 'done').length
  return STAGES.map((stage, i) => {
    const label = stageLabel({ ...s, stage })
    const milestones = MILESTONE_STAGES.has(stage) ? s.milestones.filter(m => m.stage === stage).map(m => m.label) : []
    if (i > cur) return { label, status: 'todo' as const, milestones }
    if (stage === 'done' || (i === cur && s.stage === 'done')) return { label, status: 'done' as const, milestones }
    if (i === cur) {
      const detail = stage === 'exec' ? `${done}/${totalOf(s)}`
        : s.stagePhase ? REPORTED_LABELS[s.stagePhase] : undefined
      return { label, status: 'active' as const, milestones, ...(detail ? { detail } : {}) }
    }
    const isEntered = s.milestones.some(m => m.stage === stage) || s.stageStartedAt?.[stage] !== undefined
    // Only the early stages can be legitimately bypassed, and only when the run never entered them; later ones are
    // always traversed.
    if (!isEntered && i < STAGES.indexOf('exec')) return { label, status: 'skipped' as const, milestones }
    const duration = stageDuration(s, i)
    return { label, status: 'done' as const, milestones, ...(duration ? { duration } : {}) }
  })
}

/** The phases still expected after `trail`, by the furthest point of the mode's sequence it reached. */
function expectedAfter(trail: readonly TaskEvent[], mode: RunState['mode']): TaskPhase[] {
  const sequence = mode === 'direct' ? INLINE_PHASES : SDD_PHASES
  const place = (phase: TaskPhase) => sequence.indexOf(mode === 'direct' ? phase : SDD_PLACE[phase] ?? phase)
  const reached = trail.reduce((furthest, e) => Math.max(furthest, place(e.phase)), -1)
  return sequence.slice(reached + 1)
}

function currentOf(s: RunState, t: TaskState): NonNullable<PaneModel['current']> {
  const last = t.trail.length - 1
  const passed = t.trail.map((e, i) => ({
    label: phaseLabel(e), status: i === last ? 'active' as const : 'done' as const, ...(e.verdict ? { verdict: e.verdict } : {}),
  }))
  const expected = expectedAfter(t.trail, s.mode).map(phase => ({ label: phaseLabel({ phase, at: 0 }), status: 'todo' as const }))
  return { n: t.n, title: t.title, trail: [...passed, ...expected] }
}

export function paneModel(s: RunState, now: number, rows: number): PaneModel {
  const cur = currentTask(s)
  const current = cur ? currentOf(s, cur) : undefined
  const stages = stagesOf(s)
  const curIndex = cur ? s.tasks.indexOf(cur) : Math.max(0, s.tasks.findIndex(t => t.status !== 'done'))
  const extraRows = stages.reduce((n, g) => n + g.milestones.length, 0) + (current?.trail.length ?? 0)
  const { start, end } = visibleWindow(s.tasks.length, rows - PANE_CHROME_ROWS - extraRows, curIndex)
  const est = estimate(s, now)
  const elapsed = elapsedOf(s, now)
  return {
    title: s.planPath ? `superpowers · ${planSlug(s.planPath)}` : 'superpowers',
    ...(elapsed ? { elapsed } : {}),
    stages,
    tasks: s.tasks.slice(start, end).map(t => ({
      n: t.n, title: t.title, status: t.status, fixRounds: t.fixRounds,
      ...(t.status === 'done' && t.startedAt && t.doneAt ? { duration: formatDuration(t.doneAt - t.startedAt) } : {}),
    })),
    hiddenTasks: s.tasks.length - (end - start),
    ...(current ? { current } : {}),
    decisions: s.decisions,
    ...(est ? { eta: `avg ${formatDuration(est.avgMs)}/task · ~${formatDuration(est.remainingMs)} left · ETA ${formatClock(est.finishAt)}` } : {}),
  }
}
