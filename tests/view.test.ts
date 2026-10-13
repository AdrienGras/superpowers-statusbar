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
    '● exec SDD ▰▰▰▰▰▰▱▱▱▱▱▱▱▱▱ 7/15 · Task 7 « Parser du ledger » · relecture · fix 2/5 · 42 min')
})

test('band drops elapsed, then title, then bar as columns shrink', () => {
  const s = seven()
  const full = text(bandSegments(s, NOW, 200))
  const noElapsed = text(bandSegments(s, NOW, full.length - 1))
  expect(noElapsed).not.toContain('42 min')
  expect(noElapsed).toContain('« Parser du ledger »')
  const noTitle = text(bandSegments(s, NOW, noElapsed.length - 1))
  expect(noTitle).not.toContain('«')
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
  expect(text(bandSegments(s, NOW, 200))).toBe('● exec SDD ▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱ 1/3 · Task 1 « T1 » · fix 1/5 · 42 min')
})

test("band leads with T'ATTEND and the wait text when waiting", () => {
  const s: RunState = { ...seven(), waiting: { reason: 'blocked', task: '7', since: 5 } }
  const segs = bandSegments(s, NOW, 200)
  expect(segs[0]).toEqual({ text: "T'ATTEND", tone: 'wait', isBold: true })
  expect(text(segs).startsWith("T'ATTEND Task 7 bloquée")).toBe(true)
})

test('band summarises a finished run', () => {
  const s: RunState = {
    ...execRun(2, 2), stage: 'done', startedAt: 1000, finishedAt: 1000 + 65 * MIN,
    tasks: [mkTask(1, { status: 'done', fixRounds: 1 }), mkTask(2, { status: 'done', fixRounds: 2 })],
    decisions: [
      { kind: 'parked', task: '1', text: 'a' }, { kind: 'minor', text: 'b' }, { kind: 'ruling', text: 'c' },
    ],
  }
  expect(text(bandSegments(s, NOW, 200))).toBe('✓ terminé · 2 tâches · 3 fix rounds · 2 points mis de côté · 1 h 05')
})

test('band in brainstorm shows the reported phase', () => {
  const s: RunState = { ...newRun('brainstorm', 1000), stagePhase: 'awaiting-approval' }
  expect(text(bandSegments(s, NOW, 200))).toBe('● brainsto · spec à valider')
})

test('band in plan shows the task count when no phase is reported', () => {
  const s: RunState = { ...newRun('plan', 1000), tasks: [mkTask(1), mkTask(2), mkTask(3)] }
  expect(text(bandSegments(s, NOW, 200))).toBe('● plan · 3 tâches')
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
  expect(formatDuration(42 * MIN)).toBe('42 min')
  expect(formatDuration(65 * MIN)).toBe('1 h 05')
  expect(formatDuration(120 * MIN)).toBe('2 h 00')
})

test('paneModel folds tasks around the current one', () => {
  const s = execRun(7, 15, { trail: [{ phase: 'review', at: 1, verdict: 'Approved' }] })
  const p = paneModel(s, NOW, 24)
  expect(p.tasks).toHaveLength(10)
  expect(p.tasks.map(t => t.n)).toContain('8')
  expect(p.hiddenTasks).toBe(5)
  expect(p.current).toEqual({ n: '8', trail: ['relecture (Approved)'] })
  expect(p.eta).toMatch(/^moy\. 6 min\/tâche · reste ~48 min · fin vers \d\d:\d\d$/)
})

test('paneModel shows at least 3 task rows', () => {
  expect(paneModel(execRun(7, 15), NOW, 5).tasks).toHaveLength(3)
})

test('paneModel marks unreached earlier stages as skipped', () => {
  const s: RunState = { ...execRun(1, 3), planPath: 'docs/superpowers/plans/2026-01-01-recettes.md' }
  const p = paneModel(s, NOW, 30)
  expect(p.title).toBe('superpowers · recettes')
  expect(p.stages.map(g => [g.label, g.status])).toEqual([
    ['brainsto', 'skipped'], ['plan', 'skipped'], ['exec SDD', 'active'],
    ['revue finale', 'todo'], ['fin de branche', 'todo'], ['terminé', 'todo'],
  ])
  expect(p.stages[2]!.detail).toBe('1/3')
  expect(paneModel(newRun('exec', 1, 'direct'), NOW, 30).title).toBe('superpowers')
})
