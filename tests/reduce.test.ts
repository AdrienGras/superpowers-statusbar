import { test, expect } from 'claude-code/testing'

import type { Action, RunState } from '../types'
import { reduce, newRun, currentTask } from '../src/reduce.ts'
import { parseReport } from '../src/reports.ts'

const run = (s: RunState | null, actions: Action[]): RunState | null =>
  actions.reduce<RunState | null>((acc, a) => reduce(acc, a), s)

const must = (s: RunState | null): RunState => {
  if (!s) throw new Error('expected a run')
  return s
}

const task = (s: RunState | null, n: string) => {
  const t = must(s).tasks.find(x => x.n === n)
  if (!t) throw new Error(`no task ${n}`)
  return t
}

const PLAN: Action = {
  type: 'plan-loaded', path: '/p/plan.md', at: 20,
  tasks: [{ n: '1', title: 'Modèle', steps: 3 }, { n: '2', title: 'Repository', steps: 2 }],
}

const execRun = (mode: 'sdd' | 'direct' = 'sdd') =>
  run(null, [{ type: 'stage-entered', stage: 'exec', mode, at: 10 }, PLAN])

test('stage-entered starts a run and advances without going back', () => {
  const s = run(null, [
    { type: 'stage-entered', stage: 'brainstorm', at: 1 },
    { type: 'stage-entered', stage: 'plan', at: 2 },
    { type: 'stage-entered', stage: 'exec', mode: 'sdd', at: 3 },
  ])
  expect(must(s).stage).toBe('exec')
  expect(must(s).mode).toBe('sdd')
  expect(must(s).id).toBe('run-1')
  expect(must(s).startedAt).toBe(1)
  expect(must(s).milestones).toContainEqual({ stage: 'exec', label: 'exec SDD', at: 3 })

  const again = reduce(s, { type: 'stage-entered', stage: 'plan', at: 4 })
  expect(must(again).id).toBe('run-4')
  expect(must(again).stage).toBe('plan')
  expect(must(again).tasks).toEqual([])
})

test('stage-entered exec on a null state starts a run at exec with mode', () => {
  const s = reduce(null, { type: 'stage-entered', stage: 'exec', mode: 'direct', at: 5 })
  expect(must(s).stage).toBe('exec')
  expect(must(s).mode).toBe('direct')
  expect(must(s).milestones).toEqual([{ stage: 'exec', label: 'exec direct', at: 5 }])
  expect(newRun('plan', 7)).toEqual({
    id: 'run-7', startedAt: 7, stage: 'plan', tasks: [], milestones: [], agents: {}, decisions: [],
  })
})

test('actions other than stage-entered leave a null state null', () => {
  expect(reduce(null, PLAN)).toBeNull()
  expect(reduce(null, { type: 'branch-finished', at: 1 })).toBeNull()
})

test('stage-entered after done starts a new run', () => {
  const s = run(execRun(), [{ type: 'branch-finished', at: 50 }])
  const next = reduce(s, { type: 'stage-entered', stage: 'exec', mode: 'sdd', at: 60 })
  expect(must(next).id).toBe('run-60')
  expect(must(next).tasks).toEqual([])
})

test('brainstorm milestones and phases', () => {
  const s = run(null, [
    { type: 'stage-entered', stage: 'brainstorm', at: 1 },
    { type: 'phase-reported', phase: 'design-writing', at: 2 },
    { type: 'spec-written', path: '/p/specs/x-design.md', at: 3 },
    { type: 'phase-reported', phase: 'builder-check', at: 4 },
    { type: 'agent-dispatched', agentId: 'b1', role: 'builder-check', isRunning: false, at: 4 },
    { type: 'phase-reported', phase: 'awaiting-approval', at: 5 },
  ])
  expect(must(s).stagePhase).toBe('awaiting-approval')
  expect(must(s).specPath).toBe('/p/specs/x-design.md')
  expect(must(s).milestones).toEqual([
    { stage: 'brainstorm', label: 'spec écrite', at: 3 },
    { stage: 'brainstorm', label: 'builder check', at: 4 },
    { stage: 'brainstorm', label: 'spec à valider', at: 5 },
  ])
  const p = reduce(s, PLAN)
  expect(must(p).stage).toBe('plan')
  expect(must(p).planPath).toBe('/p/plan.md')
  expect(must(p).milestones).toContainEqual({ stage: 'plan', label: '2 tâches · 5 étapes', at: 20 })
})

test('plan-loaded replaces tasks and keeps done ones', () => {
  const s = run(execRun(), [
    { type: 'task-started', task: '1', at: 30 },
    { type: 'task-verified', task: '1', isOk: true, at: 40 },
    { type: 'task-started', task: '2', at: 41 },
    { type: 'plan-loaded', path: '/p/plan.md', at: 50, tasks: [
      { n: '1', title: 'Modèle', steps: 3 },
      { n: '2', title: 'Repository v2', steps: 4 },
      { n: '3', title: 'Vue', steps: 1 },
    ] },
  ])
  expect(must(s).tasks.map(t => [t.n, t.status])).toEqual([['1', 'done'], ['2', 'active'], ['3', 'todo']])
  expect(task(s, '1').doneAt).toBe(40)
  expect(task(s, '2').title).toBe('Repository v2')
  expect(task(s, '2').startedAt).toBe(41)
  expect(task(s, '3')).toEqual({ n: '3', title: 'Vue', steps: 1, status: 'todo', fixRounds: 0, trail: [] })
  expect(must(s).milestones.filter(m => m.stage === 'plan')).toEqual([{ stage: 'plan', label: '3 tâches · 8 étapes', at: 50 }])
})

test('task-started adds a task missing from the plan', () => {
  const s = reduce(execRun(), { type: 'task-started', task: '9', at: 30 })
  expect(task(s, '9')).toEqual({
    n: '9', title: '?', steps: 0, status: 'active', startedAt: 30, fixRounds: 0, trail: [{ phase: 'brief', at: 30 }],
  })
})

test('sdd task flows through writing, review, fix and re-review', () => {
  const s = run(execRun(), [
    { type: 'task-started', task: '1', at: 30 },
    { type: 'agent-dispatched', agentId: 'a1', role: 'implementer', task: '1', isRunning: true, at: 31 },
    { type: 'agent-reported', agentId: 'a1', answer: 'done\n- **Status:** DONE\n', at: 32 },
    { type: 'agent-dispatched', agentId: 'r1', role: 'reviewer', task: '1', isRunning: false, at: 33 },
    { type: 'agent-reported', agentId: 'r1', answer: '### Assessment\n\n**Task quality:** Needs fixes\n', at: 34 },
    { type: 'agent-resumed', agentId: 'a1', at: 35 },
    { type: 'agent-dispatched', agentId: 'rr1', role: 're-reviewer', task: '1', round: 1, isRunning: false, at: 36 },
    { type: 'agent-reported', agentId: 'rr1', answer: '**Fix round:** All findings addressed, no new Critical/Important breakage', at: 37 },
    { type: 'ledger-loaded', lines: [{ kind: 'complete', task: '1' }], at: 38 },
  ])
  const t = task(s, '1')
  expect(t.status).toBe('done')
  expect(t.doneAt).toBe(38)
  expect(t.fixRounds).toBe(1)
  expect(t.lastStatus).toBe('DONE')
  expect(t.implementerId).toBe('a1')
  expect(t.trail.map(e => e.phase)).toEqual(['brief', 'writing', 'review', 'fix', 're-review', 'done'])
  expect(t.trail[2]!.verdict).toBe('à corriger')
  expect(t.trail[3]!.round).toBe(1)
  expect(t.trail[4]).toEqual({ phase: 're-review', at: 36, round: 1, verdict: 'ok' })
  expect(must(s).agents['a1']!.isRunning).toBe(true)
  expect(must(s).agents['r1']).toEqual({ role: 'reviewer', task: '1', isRunning: false })
})

test('resuming an implementer without an open review is not a fix', () => {
  const s = run(execRun(), [
    { type: 'task-started', task: '1', at: 30 },
    { type: 'agent-dispatched', agentId: 'a1', role: 'implementer', task: '1', isRunning: false, at: 31 },
    { type: 'agent-resumed', agentId: 'a1', at: 32 },
    { type: 'agent-dispatched', agentId: 'r1', role: 'reviewer', task: '1', isRunning: false, at: 33 },
    { type: 'agent-reported', agentId: 'r1', answer: '**Task quality:** Needs fixes', at: 34 },
    { type: 'agent-resumed', agentId: 'a1', at: 35 },
    { type: 'agent-resumed', agentId: 'a1', at: 36 },
  ])
  expect(task(s, '1').fixRounds).toBe(1)
  expect(task(s, '1').trail.map(e => e.phase)).toEqual(['brief', 'writing', 'review', 'fix'])
})

test('a fresh implementer or an other agent after an unclean review is a fix round', () => {
  const s = run(execRun(), [
    { type: 'task-started', task: '1', at: 30 },
    { type: 'agent-dispatched', agentId: 'a1', role: 'implementer', task: '1', isRunning: false, at: 31 },
    { type: 'agent-dispatched', agentId: 'r1', role: 'reviewer', task: '1', isRunning: false, at: 32 },
    { type: 'agent-reported', agentId: 'r1', answer: '**Task quality:** Needs fixes', at: 33 },
    { type: 'agent-dispatched', agentId: 'a4', role: 'implementer', task: '1', isRunning: false, at: 34 },
    { type: 'agent-dispatched', agentId: 'rr', role: 're-reviewer', task: '1', round: 1, isRunning: false, at: 35 },
    { type: 'agent-reported', agentId: 'rr', answer: '**Fix round:** Findings remain open', at: 36 },
    { type: 'agent-dispatched', agentId: 'o5', role: 'other', isRunning: false, at: 37 },
  ])
  const t = task(s, '1')
  expect(t.fixRounds).toBe(2)
  expect(t.implementerId).toBe('a4')
  expect(t.trail.map(e => [e.phase, e.round])).toEqual([
    ['brief', undefined], ['writing', undefined], ['review', undefined], ['fix', 1], ['re-review', 1], ['fix', 2],
  ])
  expect(must(s).agents['o5']!.task).toBe('1')
})

test('report arriving before dispatch is applied on dispatch', () => {
  const early = reduce(execRun(), { type: 'agent-reported', agentId: 'x', answer: '- **Status:** BLOCKED', at: 30 })
  expect(must(early).agents['x']).toEqual({ role: 'unknown', isRunning: false, pendingAnswer: '- **Status:** BLOCKED' })
  const s = reduce(early, { type: 'agent-dispatched', agentId: 'x', role: 'implementer', task: '2', isRunning: false, at: 31 })
  expect(task(s, '2').lastStatus).toBe('BLOCKED')
  expect(task(s, '2').status).toBe('active')
  expect(must(s).agents['x']).toEqual({ role: 'implementer', task: '2', isRunning: false })
})

test('fifth unclean re-review trips the breaker', () => {
  let s = run(execRun(), [
    { type: 'task-started', task: '1', at: 30 },
    { type: 'agent-dispatched', agentId: 'a1', role: 'implementer', task: '1', isRunning: false, at: 31 },
    { type: 'agent-dispatched', agentId: 'r1', role: 'reviewer', task: '1', isRunning: false, at: 32 },
    { type: 'agent-reported', agentId: 'r1', answer: '**Task quality:** Needs fixes', at: 33 },
  ])
  for (let r = 1; r <= 5; r++) {
    s = run(s, [
      { type: 'agent-resumed', agentId: 'a1', at: 40 + r * 2 },
      { type: 'agent-dispatched', agentId: `rr${r}`, role: 're-reviewer', task: '1', round: r, isRunning: false, at: 41 + r * 2 },
      { type: 'agent-reported', agentId: `rr${r}`, answer: '**Fix round:** Findings remain open', at: 41 + r * 2 },
    ])
    expect(task(s, '1').isBreakerTripped).toBe(r === 5 ? true : undefined)
  }
  expect(task(s, '1').fixRounds).toBe(5)
})

test('final review not clean in direct mode moves to fixes', () => {
  const s = run(execRun('direct'), [
    { type: 'agent-dispatched', agentId: 'f1', role: 'final-reviewer', isRunning: false, at: 60 },
  ])
  expect(must(s).stage).toBe('final-review')
  expect(must(s).finalReview).toEqual({ phase: 'review' })
  const r = reduce(s, { type: 'agent-reported', agentId: 'f1', answer: '**Ready to merge?** With fixes', at: 61 })
  expect(must(r).finalReview).toEqual({ phase: 'fixes', verdict: 'avec corrections' })
  const done = reduce(r, { type: 'workspace-removed', at: 70 })
  expect(must(done).finalReview).toEqual({ phase: 'done', verdict: 'avec corrections' })
})

test('final review not clean in sdd mode moves to fixes when a fixer is dispatched', () => {
  const s = run(execRun('sdd'), [
    { type: 'agent-dispatched', agentId: 'f1', role: 'final-reviewer', isRunning: false, at: 60 },
    { type: 'agent-reported', agentId: 'f1', answer: '**Ready to merge: With fixes**', at: 61 },
  ])
  expect(must(s).finalReview).toEqual({ phase: 'review', verdict: 'avec corrections' })
  const f = reduce(s, { type: 'agent-dispatched', agentId: 'o1', role: 'other', isRunning: true, at: 62 })
  expect(must(f).finalReview!.phase).toBe('fixes')
})

test('clean final review is done', () => {
  const s = run(execRun(), [
    { type: 'agent-dispatched', agentId: 'f1', role: 'final-reviewer', isRunning: true, at: 60 },
    { type: 'agent-reported', agentId: 'f1', answer: '**Ready to merge?** Yes', at: 61 },
  ])
  expect(must(s).finalReview).toEqual({ phase: 'done', verdict: 'prêt' })
  expect(must(s).agents['f1']!.isRunning).toBe(false)
})

test('branch-finished ends the run', () => {
  const s = run(execRun(), [
    { type: 'stage-entered', stage: 'finishing', at: 80 },
    { type: 'branch-finished', at: 90 },
  ])
  expect(must(s).stage).toBe('done')
  expect(must(s).finishedAt).toBe(90)
})

test('tdd phases reported by an implementer land on its task', () => {
  const s = run(execRun(), [
    { type: 'task-started', task: '2', at: 30 },
    { type: 'agent-dispatched', agentId: 'a2', role: 'implementer', task: '2', isRunning: true, at: 31 },
    { type: 'phase-reported', phase: 'red', agentId: 'a2', at: 32 },
  ])
  expect(task(s, '2').trail.map(e => e.phase)).toContain('red')
})

test('tdd phases without agent land on the current task, verify closes it', () => {
  const s = run(execRun('direct'), [
    { type: 'task-started', task: '1', at: 30 },
    { type: 'phase-reported', phase: 'red', at: 31 },
    { type: 'phase-reported', phase: 'green', at: 32 },
    { type: 'phase-reported', phase: 'refactor', at: 33 },
    { type: 'task-verified', task: '1', isOk: false, at: 34 },
    { type: 'task-verified', task: '1', isOk: true, at: 35 },
  ])
  const t = task(s, '1')
  expect(t.trail).toEqual([
    { phase: 'brief', at: 30 }, { phase: 'red', at: 31 }, { phase: 'green', at: 32 }, { phase: 'refactor', at: 33 },
    { phase: 'verify', at: 34, verdict: 'échec' }, { phase: 'verify', at: 35 }, { phase: 'done', at: 35 },
  ])
  expect(t.status).toBe('done')
  expect(t.doneAt).toBe(35)
  expect(must(s).stagePhase).toBeUndefined()
})

test('currentTask returns the most recently started active task', () => {
  const s = run(execRun(), [
    { type: 'task-started', task: '2', at: 30 },
    { type: 'task-started', task: '1', at: 31 },
  ])
  expect(must(s).tasks.filter(t => t.status === 'active').length).toBe(2)
  expect(currentTask(must(s))?.n).toBe('1')
  const byActivity = run(execRun(), [
    { type: 'task-started', task: '1', at: 0 },
    { type: 'agent-dispatched', agentId: 'a1', role: 'implementer', task: '1', isRunning: true, at: 0 },
    { type: 'task-started', task: '2', at: 0 },
    { type: 'phase-reported', phase: 'red', agentId: 'a1', at: 5 },
  ])
  expect(currentTask(must(byActivity))?.n).toBe('1')
  const fullTie = run(execRun(), [
    { type: 'task-started', task: '2', at: 0 },
    { type: 'task-started', task: '1', at: 0 },
  ])
  expect(currentTask(must(fullTie))?.n).toBe('2')
  expect(currentTask(must(execRun()))).toBeUndefined()
})

test('ledger-loaded marks completions, raises fix rounds and records decisions', () => {
  const s = run(execRun(), [
    { type: 'task-started', task: '1', at: 30 },
    { type: 'ledger-loaded', at: 40, lines: [
      { kind: 'complete', task: '1' },
      { kind: 'fix-round', task: '2', round: 2 },
      { kind: 'parked', task: '2', text: 'borne' },
      { kind: 'complete', task: '7' },
    ] },
  ])
  expect(task(s, '1').status).toBe('done')
  expect(task(s, '2').fixRounds).toBe(2)
  expect(must(s).decisions).toEqual([{ kind: 'parked', task: '2', text: 'borne' }])
  expect(must(s).tasks.length).toBe(2)
})

test('workspace-found and workspace-removed', () => {
  const s = reduce(execRun(), { type: 'workspace-found', path: '/w', planPath: '/p/plan2.md', at: 25 })
  expect(must(s).workspace).toBe('/w')
  expect(must(s).planPath).toBe('/p/plan2.md')
  expect(must(reduce(s, { type: 'workspace-removed', at: 26 })).finalReview).toEqual({ phase: 'done' })
})

test('reduce never mutates its input', () => {
  const s = must(run(execRun(), [
    { type: 'task-started', task: '1', at: 30 },
    { type: 'agent-dispatched', agentId: 'a1', role: 'implementer', task: '1', isRunning: true, at: 31 },
  ]))
  const before = JSON.stringify(s)
  run(s, [
    { type: 'agent-reported', agentId: 'a1', answer: '**Status:** DONE', at: 32 },
    { type: 'phase-reported', phase: 'red', at: 33 },
    { type: 'ledger-loaded', lines: [{ kind: 'complete', task: '1' }], at: 34 },
    { type: 'turn-ended', at: 35 },
  ])
  expect(JSON.stringify(s)).toBe(before)
  expect(reduce(s, { type: 'turn-started', at: 36 })).toBe(s)
})

test('parseReport reads each report format', () => {
  expect(parseReport('implementer', 'x\n- **Status:** DONE_WITH_CONCERNS\n')).toEqual({ status: 'DONE_WITH_CONCERNS' })
  expect(parseReport('reviewer', '**Task quality:** Approved')).toEqual({ verdict: 'ok', isClean: true })
  expect(parseReport('reviewer', '**Task quality:** Needs fixes')).toEqual({ verdict: 'à corriger', isClean: false })
  expect(parseReport('reviewer', 'Spec: ❌ missing\n**Task quality:** Approved')).toEqual({ verdict: 'à corriger', isClean: false })
  expect(parseReport('re-reviewer', '**Fix round:** All findings addressed, no new Critical/Important breakage')).toEqual({ verdict: 'ok', isClean: true })
  expect(parseReport('re-reviewer', '**Fix round:** Findings remain open — x')).toEqual({ verdict: 'ouvert', isClean: false })
  expect(parseReport('final-reviewer', '**Ready to merge?** Yes')).toEqual({ verdict: 'prêt', isClean: true })
  expect(parseReport('final-reviewer', '**Ready to merge?** With fixes')).toEqual({ verdict: 'avec corrections', isClean: false })
  expect(parseReport('final-reviewer', '**Ready to merge?** No')).toEqual({ verdict: 'non', isClean: false })
  expect(parseReport('implementer', 'nothing here')).toEqual({})
  expect(parseReport('other', '**Status:** DONE')).toEqual({})
})
