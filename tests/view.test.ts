import { test, expect } from 'claude-code/testing'

import type { RunState, TaskState } from '../types'
import { newRun } from '../src/reduce.ts'
import {
  bandSegments, estimate, formatDuration, paneModel,
} from '../src/view.ts'

const MIN = 60_000
const text = (segs: { text: string }[]) => segs.map(g => g.text).join('')

const mkTask = (i: number, over: Partial<TaskState> = {}): TaskState => ({
  n: String(i), title: `T${i}`, steps: 1, status: 'todo', fixRounds: 0, trail: [], ...over,
})

function execRun(done: number, total: number, over: Partial<TaskState> = {}): RunState {
  const tasks = Array.from({ length: total }, (_, k) => {
    const i = k + 1
    if (i <= done) return mkTask(i, { status: 'done', startedAt: i * 10 * MIN, doneAt: i * 10 * MIN + 6 * MIN })
    if (i === done + 1) return mkTask(i, { status: 'active', startedAt: i * 10 * MIN, ...over })
    return mkTask(i)
  })
  return { ...newRun('exec', 1000, 'sdd'), startedAt: 1000, tasks }
}

const NOW = 1000 + 42 * MIN

function seven(): RunState {
  const s = execRun(6, 15, {
    title: 'Parser du ledger', fixRounds: 2, trail: [{ phase: 'review', at: 5 }],
  })
  return s
}

test('band shows stage, bar, counter, task title, phase, fix round and elapsed', () => {
  expect(text(bandSegments(seven(), NOW, 200))).toBe(
    '● exec SDD ▰▰▰▰▰▰▱▱▱▱▱▱▱▱▱ 7/15 · Task 7: Parser du ledger · review · fix 2/5 · 42m')
})

test('band bar stays short of full while a task remains', () => {
  const s = execRun(30, 31)
  const filled = bandSegments(s, NOW, 200).filter(g => g.text.startsWith('▰')).map(g => g.text).join('')
  expect(filled).toBe('▰'.repeat(14))
  expect(text(bandSegments(s, NOW, 200))).toContain('▱')
})

test('band drops elapsed, then title, then bar as columns shrink', () => {
  const s = seven()
  const full = text(bandSegments(s, NOW, 200))
  const noElapsed = text(bandSegments(s, NOW, full.length - 1))
  expect(noElapsed).not.toContain('42m')
  expect(noElapsed).toContain('Task 7: Parser du ledger')
  const noTitle = text(bandSegments(s, NOW, noElapsed.length - 1))
  expect(noTitle).not.toContain('Parser du ledger')
  expect(noTitle).toContain('Task 7')
  expect(noTitle).toContain('▰')
  const noBar = text(bandSegments(s, NOW, noTitle.length - 1))
  expect(noBar).not.toContain('▰')
  const tiny = text(bandSegments(s, NOW, 30))
  expect(tiny).toContain('exec SDD')
  expect(tiny).toContain('7/15')
})

test('band does not repeat a fix phase as a fix round', () => {
  const s = execRun(0, 3, { fixRounds: 1, trail: [{ phase: 'fix', round: 1, at: 5 }] })
  expect(text(bandSegments(s, NOW, 200))).toBe('● exec SDD ▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱ 1/3 · Task 1: T1 · fix 1/5 · 42m')
})

test('band leads with one continuous WAITING block, the counter outside it', () => {
  const s: RunState = { ...seven(), waiting: { reason: 'blocked', task: '7', since: 5 } }
  const segs = bandSegments(s, NOW, 200)
  expect(segs.slice(0, 3)).toEqual([
    { text: ' ', tone: 'wait' },
    { text: 'WAITING', tone: 'wait', isBold: true },
    { text: ' · Task 7 blocked ', tone: 'wait' },
  ])
  expect(segs.slice(3).every(g => g.tone !== 'wait')).toBe(true)
  expect(text(segs)).toBe(' WAITING · Task 7 blocked  · 7/15')
})

test('waiting plan band is the block only', () => {
  const s: RunState = {
    ...newRun('plan', 1000), tasks: Array.from({ length: 15 }, (_, k) => mkTask(k + 1)),
    waiting: { reason: 'execution-choice', since: 5 },
  }
  const segs = bandSegments(s, NOW, 200)
  expect(segs.every(g => g.tone === 'wait')).toBe(true)
  expect(text(segs)).toBe(' WAITING · plan ready (15 tasks) · pick an execution mode ')
})

test('waiting band truncates the reason inside the block and omits the counter when narrow', () => {
  const s: RunState = { ...seven(), waiting: { reason: 'blocked', task: '7', since: 5 } }
  const full = ' WAITING · Task 7 blocked '
  const noCounter = bandSegments(s, NOW, full.length + 3)
  expect(text(noCounter)).toBe(full)
  const narrow = bandSegments(s, NOW, 20)
  expect(text(narrow)).toBe(' WAITING · Task 7 … ')
  expect(narrow.every(g => g.tone === 'wait')).toBe(true)
  const plan: RunState = { ...newRun('plan', 1), waiting: { reason: 'execution-choice', since: 5 } }
  const cut = text(bandSegments(plan, NOW, 25))
  expect(cut.length).toBe(25)
  expect(cut.endsWith('… ')).toBe(true)
})

test('band leads with a spinning mark while the run works, not while it waits or is done', () => {
  const lead = (s: RunState) => bandSegments(s, NOW, 200)[0]
  expect(lead(seven())).toEqual({ text: '●', tone: 'active', isSpinner: true })
  expect(lead(newRun('brainstorm', 1000))).toEqual({ text: '●', tone: 'active', isSpinner: true })
  expect(lead({ ...seven(), waiting: { reason: 'other', since: 5 } })?.isSpinner).toBeUndefined()
  expect(lead({ ...seven(), stage: 'done' })?.isSpinner).toBeUndefined()
})

test('band keeps the task title in default text and secondary info subtle', () => {
  const segs = bandSegments(seven(), NOW, 200)
  expect(segs.find(g => g.text === 'Task 7')?.tone).toBe('normal')
  expect(segs.find(g => g.text.includes('Parser du ledger'))?.tone).toBe('normal')
  expect(segs.find(g => g.text === '42m')?.tone).toBe('subtle')
  expect(segs.filter(g => g.text === ' · ').every(g => g.tone === 'subtle')).toBe(true)
})

test('band summarises a finished run', () => {
  const s: RunState = {
    ...execRun(2, 2), stage: 'done', startedAt: 1000, finishedAt: 1000 + 65 * MIN,
    tasks: [mkTask(1, { status: 'done', fixRounds: 1 }), mkTask(2, { status: 'done', fixRounds: 2 })],
    decisions: [
      { kind: 'parked', task: '1', text: 'a' }, { kind: 'minor', text: 'b' }, { kind: 'ruling', text: 'c' },
    ],
  }
  expect(text(bandSegments(s, NOW, 200))).toBe('✓ done · 2 tasks · 3 fix rounds · 2 set aside · 1h05')
})

test('band in brainstorm shows the reported phase', () => {
  const s: RunState = { ...newRun('brainstorm', 1000), stagePhase: 'awaiting-approval' }
  expect(text(bandSegments(s, NOW, 200))).toBe('● brainstorming · spec awaiting approval')
})

test('band in plan shows the task count when no phase is reported', () => {
  const s: RunState = { ...newRun('plan', 1000), tasks: [mkTask(1), mkTask(2), mkTask(3)] }
  expect(text(bandSegments(s, NOW, 200))).toBe('● plan · 3 tasks')
})

test('estimate averages measured tasks only', () => {
  const s = execRun(0, 4)
  s.tasks[0] = mkTask(1, { status: 'done', startedAt: 100, doneAt: 100 + 6 * MIN })
  s.tasks[1] = mkTask(2, { status: 'done', startedAt: 200, doneAt: 200 + 10 * MIN })
  s.tasks[2] = mkTask(3, { status: 'done', startedAt: 0, doneAt: 999 * MIN })
  const e = estimate(s, 5000)
  expect(e).toEqual({ avgMs: 8 * MIN, remainingMs: 8 * MIN, finishAt: 5000 + 8 * MIN })
  expect(estimate(execRun(0, 3), 0)).toBeUndefined()
  expect(estimate(execRun(3, 3), 0)).toBeUndefined()
})

test('formatDuration formats minutes and hours', () => {
  expect(formatDuration(42 * MIN)).toBe('42m')
  expect(formatDuration(65 * MIN)).toBe('1h05')
  expect(formatDuration(120 * MIN)).toBe('2h00')
})

test('paneModel folds tasks around the current one, in the rows its trail leaves', () => {
  const s = execRun(7, 15, { trail: [{ phase: 'review', at: 1, verdict: 'ok' }] })
  const p = paneModel(s, NOW, 24)
  expect(p.tasks).toHaveLength(8)
  expect(p.tasks.map(t => t.n)).toContain('8')
  expect(p.hiddenTasks).toBe(7)
  expect(p.current).toEqual({ n: '8', title: 'T8', trail: [
    { label: 'review', status: 'active', verdict: 'ok' }, { label: 'done', status: 'todo' },
  ] })
  expect(p.eta).toMatch(/^avg 6m\/task · ~48m left · ETA \d\d:\d\d$/)
})

test('paneModel shows at least 3 task rows', () => {
  expect(paneModel(execRun(7, 15), NOW, 5).tasks).toHaveLength(3)
})

test('paneModel marks unreached earlier stages as skipped', () => {
  const s: RunState = { ...execRun(1, 3), planPath: 'docs/superpowers/plans/2026-01-01-recettes.md' }
  const p = paneModel(s, NOW, 30)
  expect(p.title).toBe('superpowers · recettes')
  expect(p.stages.map(g => [g.label, g.status])).toEqual([
    ['brainstorming', 'skipped'], ['plan', 'skipped'], ['exec SDD', 'active'],
    ['final review', 'todo'], ['finishing', 'todo'], ['done', 'todo'],
  ])
  expect(p.stages[2]!.detail).toBe('1/3')
  expect(paneModel(newRun('exec', 1, 'direct'), NOW, 30).title).toBe('superpowers')
})

test('paneModel lists the SDD trail: phases passed with verdicts, the current one, then those still expected', () => {
  const brief = execRun(0, 2, { trail: [{ phase: 'brief', at: 1 }] })
  expect(paneModel(brief, NOW, 40).current?.trail).toEqual([
    { label: 'brief', status: 'active' },
    { label: 'implementing', status: 'todo' }, { label: 'review', status: 'todo' }, { label: 'done', status: 'todo' },
  ])
  const fixing = execRun(0, 2, { fixRounds: 1, trail: [
    { phase: 'brief', at: 1 }, { phase: 'writing', at: 2 }, { phase: 'red', at: 3 },
    { phase: 'review', at: 4, verdict: 'needs fixes' }, { phase: 'fix', at: 5, round: 1 },
  ] })
  expect(paneModel(fixing, NOW, 40).current?.trail).toEqual([
    { label: 'brief', status: 'done' }, { label: 'implementing', status: 'done' }, { label: 'RED', status: 'done' },
    { label: 'review', status: 'done', verdict: 'needs fixes' }, { label: 'fix 1/5', status: 'active' },
    { label: 'done', status: 'todo' },
  ])
})

test('paneModel lists the inline trail through RED, GREEN, refactor and verify', () => {
  const s: RunState = { ...execRun(0, 2, { trail: [{ phase: 'brief', at: 1 }, { phase: 'red', at: 2 }] }), mode: 'direct' }
  expect(paneModel(s, NOW, 40).current?.trail).toEqual([
    { label: 'brief', status: 'done' }, { label: 'RED', status: 'active' },
    { label: 'GREEN', status: 'todo' }, { label: 'refactor', status: 'todo' }, { label: 'verify', status: 'todo' },
    { label: 'done', status: 'todo' },
  ])
})

test('paneModel gives finished stages their span and brainstorm and plan their milestones', () => {
  const s: RunState = {
    ...execRun(1, 3),
    stageStartedAt: { brainstorm: 1000, plan: 1000 + 12 * MIN, exec: 1000 + 20 * MIN },
    milestones: [
      { stage: 'brainstorm', label: 'spec written', at: 2 }, { stage: 'brainstorm', label: 'builder check', at: 3 },
      { stage: 'plan', label: '3 tasks · 7 steps', at: 4 }, { stage: 'exec', label: 'exec SDD', at: 5 },
    ],
  }
  const stages = paneModel(s, NOW, 40).stages
  expect(stages.slice(0, 3)).toEqual([
    { label: 'brainstorming', status: 'done', duration: '12m', milestones: ['spec written', 'builder check'] },
    { label: 'plan', status: 'done', duration: '8m', milestones: ['3 tasks · 7 steps'] },
    { label: 'exec SDD', status: 'active', detail: '1/3', milestones: [] },
  ])
})

test('paneModel leaves a stage span unknown when a start is missing', () => {
  const s: RunState = {
    ...execRun(1, 3), stage: 'final-review',
    stageStartedAt: { plan: 1000, 'final-review': 1000 + 30 * MIN },
    milestones: [{ stage: 'plan', label: '3 tasks · 7 steps', at: 4 }],
  }
  const stages = paneModel(s, NOW, 40).stages
  expect(stages.map(g => [g.label, g.status, g.duration])).toEqual([
    ['brainstorming', 'skipped', undefined], ['plan', 'done', '30m'], ['exec SDD', 'done', undefined],
    ['final review', 'active', undefined], ['finishing', 'todo', undefined], ['done', 'todo', undefined],
  ])
  expect(paneModel({ ...s, stageStartedAt: undefined }, NOW, 40).stages[1]?.duration).toBeUndefined()
})

test('paneModel marks an early stage skipped only when the run never entered it', () => {
  const s: RunState = {
    ...newRun('brainstorm', 1000), stage: 'plan', milestones: [],
    stageStartedAt: { brainstorm: 1000, plan: 1000 + 5 * MIN },
  }
  expect(paneModel(s, NOW, 40).stages.slice(0, 2)).toEqual([
    { label: 'brainstorming', status: 'done', duration: '5m', milestones: [] },
    { label: 'plan', status: 'active', milestones: [] },
  ])
})
