import { test, expect } from 'claude-code/testing'

import type { RunState } from '../types'
import { replay } from '../src/detectors/index.ts'
import { SDD_RUN, DIRECT_RUN, FILES, PLAN, WORKSPACE } from './fixtures/runs.ts'

const must = (s: RunState | null): RunState => {
  if (!s) throw new Error('expected a run')
  return s
}

test('replaying an SDD run ends done with every task done and one fix round on task 2', () => {
  const s = must(replay(SDD_RUN, FILES))
  expect(s.stage).toBe('done')
  expect(s.mode).toBe('sdd')
  expect(s.planPath).toBe(PLAN)
  expect(s.tasks.map(t => [t.n, t.status])).toEqual([['1', 'done'], ['2', 'done']])
  expect(s.tasks.map(t => t.fixRounds)).toEqual([0, 1])
  for (const t of s.tasks) expect(t.doneAt! < t.startedAt!).toBe(false)
  expect(s.tasks[1]!.trail.map(e => e.phase)).toEqual(['brief', 'writing', 'review', 'fix', 're-review', 'done'])
  expect(s.finalReview).toEqual({ phase: 'done', verdict: 'ready' })
  expect(s.decisions.map(d => d.kind)).toEqual(['ruling', 'minor'])
  expect(s.waiting).toBeUndefined()
})

test('replaying a direct run records red, green, refactor and verify on each task', () => {
  const s = must(replay(DIRECT_RUN, FILES))
  expect(s.stage).toBe('done')
  expect(s.mode).toBe('direct')
  expect(s.workspace).toBe(WORKSPACE)
  for (const t of s.tasks) {
    expect(t.status).toBe('done')
    expect(t.trail.map(e => e.phase)).toEqual(['brief', 'red', 'green', 'refactor', 'verify', 'done'])
    expect(t.doneAt! < t.startedAt!).toBe(false)
  }
})

test('replaying stops waiting while the background implementer runs', () => {
  const dispatched = SDD_RUN.findIndex(e => e.kind === 'tool' && e.tool === 'Agent')
  const mainEnd = SDD_RUN.findIndex((e, i) => i > dispatched && e.kind === 'turn-end' && !e.agentId)
  const s = must(replay(SDD_RUN.slice(0, mainEnd + 1), FILES))
  expect(s.agents['impl-1']?.isRunning).toBe(true)
  expect(s.waiting).toBeUndefined()
})

test('replaying skips reads of files it was not given', () => {
  const s = must(replay(SDD_RUN))
  expect(s.tasks.map(t => t.status)).toEqual(['active', 'active'])
})

test('replaying serves successive versions of a file and repeats the last one', () => {
  const ledger = `${WORKSPACE}/progress.md`
  const touch = (at: number) => ({ kind: 'tool' as const, tool: 'Edit', input: { file_path: ledger }, at })
  const events = [...SDD_RUN.slice(0, SDD_RUN.findIndex(e => e.kind === 'tool' && e.tool === 'Agent')), touch(1), touch(2)]
  const versions = ['Ruling: a', 'Ruling: b', 'Ruling: c']
  const decisions = (n: number) => must(replay(events.slice(0, events.length - 2 + n), { ...FILES, [ledger]: versions })).decisions
  expect(decisions(0).map(d => d.text)).toEqual(['a'])
  expect(decisions(1).map(d => d.text)).toEqual(['b'])
  expect(decisions(2).map(d => d.text)).toEqual(['c'])
  expect(must(replay([...events, touch(3)], { ...FILES, [ledger]: versions })).decisions.map(d => d.text)).toEqual(['c'])
})
