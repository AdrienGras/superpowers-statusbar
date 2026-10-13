import { test, expect } from 'claude-code/testing'

import type { Action, RunState } from '../types'
import { reduce } from '../src/reduce.ts'
import { waitText, notificationFor } from '../src/notify.ts'

const run = (s: RunState | null, actions: Action[]): RunState | null =>
  actions.reduce<RunState | null>((acc, a) => reduce(acc, a), s)

const must = (s: RunState | null): RunState => {
  if (!s) throw new Error('expected a run')
  return s
}

const PLAN: Action = {
  type: 'plan-loaded', path: '/p/plan.md', at: 20,
  tasks: [{ n: '1', title: 'A', steps: 1 }, { n: '2', title: 'B', steps: 1 }, { n: '3', title: 'C', steps: 1 }],
}

const ended = (at: number): Action => ({ type: 'turn-ended', at })

test('turn end with a running background agent is not waiting', () => {
  const s = run(null, [
    { type: 'stage-entered', stage: 'exec', mode: 'sdd', at: 10 }, PLAN,
    { type: 'task-started', task: '1', at: 21 },
    { type: 'agent-dispatched', agentId: 'a1', role: 'implementer', isRunning: true, at: 22 },
    ended(30),
  ])
  expect(must(s).waiting).toBeUndefined()
})

test('turn end in plan with tasks waits for the execution choice', () => {
  const s = must(run(null, [{ type: 'stage-entered', stage: 'plan', at: 1 }, PLAN, ended(30)]))
  expect(s.waiting).toEqual({ reason: 'execution-choice', since: 30 })
  expect(waitText(s)).toBe('plan ready (3 tasks) · pick an execution mode')
})

test('turn end in plan without tasks waits as other', () => {
  const s = must(run(null, [{ type: 'stage-entered', stage: 'plan', at: 1 }, ended(5)]))
  expect(s.waiting?.reason).toBe('other')
  expect(waitText(s)).toBe('your turn')
})

test('turn end in brainstorm distinguishes question and spec approval', () => {
  const q = must(run(null, [{ type: 'stage-entered', stage: 'brainstorm', at: 1 }, ended(2)]))
  expect(q.waiting?.reason).toBe('brainstorm-question')
  expect(waitText(q)).toBe('question for you')
  const a = must(run(q, [{ type: 'phase-reported', phase: 'awaiting-approval', at: 3 }, ended(4)]))
  expect(a.waiting).toEqual({ reason: 'spec-approval', since: 4 })
  expect(waitText(a)).toBe('review the spec')
})

test('turn end with a blocked implementer waits as blocked', () => {
  const s = must(run(null, [
    { type: 'stage-entered', stage: 'exec', mode: 'sdd', at: 10 }, PLAN,
    { type: 'task-started', task: '2', at: 21 },
    { type: 'agent-dispatched', agentId: 'a1', role: 'implementer', isRunning: true, at: 22 },
    { type: 'agent-reported', agentId: 'a1', answer: '- **Status:** BLOCKED', at: 25 },
    ended(30),
  ]))
  expect(s.waiting).toEqual({ reason: 'blocked', task: '2', since: 30 })
  expect(waitText(s)).toBe('Task 2 blocked')
})

test('turn end with a tripped breaker waits as breaker', () => {
  const base = must(run(null, [
    { type: 'stage-entered', stage: 'exec', mode: 'sdd', at: 10 }, PLAN,
    { type: 'task-started', task: '1', at: 21 },
  ]))
  const s = reduce({ ...base, tasks: base.tasks.map(t => (t.n === '1' ? { ...t, isBreakerTripped: true } : t)) }, ended(40))
  expect(must(s).waiting).toEqual({ reason: 'breaker', task: '1', since: 40 })
  expect(waitText(must(s))).toBe('Task 1 · 5 fix rounds used up')
})

test('turn end in exec otherwise waits as other, final-review as other, done not at all', () => {
  const exec = must(run(null, [{ type: 'stage-entered', stage: 'exec', mode: 'sdd', at: 10 }, PLAN, ended(30)]))
  expect(exec.waiting).toEqual({ reason: 'other', since: 30 })
  const fr = must(run(null, [{ type: 'stage-entered', stage: 'final-review', at: 1 }, ended(2)]))
  expect(fr.waiting?.reason).toBe('other')
  const done = must(run(null, [{ type: 'stage-entered', stage: 'done', at: 1 }, ended(2)]))
  expect(done.waiting).toBeUndefined()
})

test('turn end in finishing waits on the finishing menu', () => {
  const s = must(run(null, [{ type: 'stage-entered', stage: 'finishing', at: 1 }, ended(2)]))
  expect(s.waiting).toEqual({ reason: 'finishing-menu', since: 2 })
  expect(waitText(s)).toBe('ready for your test · finishing menu')
})

test('turn-started clears waiting', () => {
  const s = must(run(null, [
    { type: 'stage-entered', stage: 'finishing', at: 1 }, ended(2), { type: 'turn-started', at: 3 },
  ]))
  expect(s.waiting).toBeUndefined()
})

test('a turn that answers the finishing menu without a finishing action ends the run', () => {
  const answered = must(run(null, [
    { type: 'stage-entered', stage: 'finishing', at: 1 }, ended(2), { type: 'turn-started', at: 3 },
  ]))
  const kept = must(reduce(answered, ended(4)))
  expect(kept).toMatchObject({ stage: 'done', finishedAt: 4 })
  expect(kept.waiting).toBeUndefined()
  expect(notificationFor(answered, kept)).toBeUndefined()
  const later = must(run(kept, [{ type: 'turn-started', at: 5 }, ended(6)]))
  expect(later).toMatchObject({ stage: 'done', finishedAt: 4 })
  expect(later.waiting).toBeUndefined()
})

test('a turn end in finishing before the menu was answered still waits on it', () => {
  // The finishing skill entered mid-turn: the turn that shows the menu is not an answer to it.
  const s = must(run(null, [
    { type: 'stage-entered', stage: 'final-review', at: 1 }, ended(2), { type: 'turn-started', at: 3 },
    { type: 'stage-entered', stage: 'finishing', at: 4 }, ended(5),
  ]))
  expect(s).toMatchObject({ stage: 'finishing', waiting: { reason: 'finishing-menu', since: 5 } })
})

test('a merge after the menu ends the run on the merge', () => {
  const s = must(run(null, [
    { type: 'stage-entered', stage: 'finishing', at: 1 }, ended(2), { type: 'turn-started', at: 3 },
    { type: 'branch-finished', at: 4 }, ended(5),
  ]))
  expect(s).toMatchObject({ stage: 'done', finishedAt: 4 })
  expect(s.waiting).toBeUndefined()
})

test('notificationFor fires once per wait and never for brainstorm questions', () => {
  const base = must(run(null, [{ type: 'stage-entered', stage: 'finishing', at: 1 }]))
  const waiting = must(reduce(base, ended(2)))
  expect(notificationFor(base, waiting)).toBe('ready for your test · finishing menu')
  expect(notificationFor(waiting, waiting)).toBeUndefined()
  expect(notificationFor(null, waiting)).toBe('ready for your test · finishing menu')
  expect(notificationFor(waiting, must(reduce(waiting, ended(9))))).toBe('ready for your test · finishing menu')
  expect(notificationFor(waiting, null)).toBeUndefined()

  const q = must(run(null, [{ type: 'stage-entered', stage: 'brainstorm', at: 1 }, ended(2)]))
  expect(notificationFor(null, q)).toBeUndefined()
  const a = must(run(q, [{ type: 'phase-reported', phase: 'awaiting-approval', at: 3 }, ended(4)]))
  expect(notificationFor(q, a)).toBeUndefined()
})
