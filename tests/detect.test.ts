import { test, expect } from 'claude-code/testing'

import type { ObservedEvent, RunState, Stage } from '../types'
import { detect } from '../src/detectors/index.ts'
import { newRun } from '../src/reduce.ts'

const AT = 50
const WS = '/repo/.superpowers/sdd/2026-01-01-recettes'
const PLAN_PATH = 'docs/superpowers/plans/2026-01-01-recettes.md'

const state = (stage: Stage, extra: Partial<RunState> = {}): RunState => ({ ...newRun(stage, 1), ...extra })

type ToolEvent = Extract<ObservedEvent, { kind: 'tool' }>

const tool = (name: string, input: Record<string, unknown>, extra: Partial<ToolEvent> = {}): ToolEvent =>
  ({ kind: 'tool', tool: name, input, at: AT, ...extra })

const bash = (command: string, text = '', extra: Partial<ToolEvent> = {}) =>
  tool('Bash', { command }, { text, ...extra })

const agent = (input: Record<string, unknown>, result: unknown) => tool('Agent', input, { result })

const asyncResult = (agentId: string) => ({ status: 'async_launched', agentId, description: 'x', prompt: 'x' })

const empty = { actions: [], reads: [] }

// --- skills ---

test('detect maps each run skill to its stage', () => {
  const at = AT
  expect(detect({ kind: 'skill', skill: 'superpowers:brainstorming', at }, null).actions)
    .toEqual([{ type: 'stage-entered', stage: 'brainstorm', at }])
  expect(detect({ kind: 'skill', skill: 'writing-plans', at }, null).actions)
    .toEqual([{ type: 'stage-entered', stage: 'plan', at }])
  expect(detect({ kind: 'skill', skill: 'superpowers:subagent-driven-development', at }, null).actions)
    .toEqual([{ type: 'stage-entered', stage: 'exec', mode: 'sdd', at }])
  expect(detect({ kind: 'skill', skill: 'superpowers:executing-plans', at }, null).actions)
    .toEqual([{ type: 'stage-entered', stage: 'exec', mode: 'direct', at }])
  expect(detect({ kind: 'skill', skill: 'superpowers:finishing-a-development-branch', at }, null).actions)
    .toEqual([{ type: 'stage-entered', stage: 'finishing', at }])
})

test('detect ignores skills outside the run chain', () => {
  expect(detect({ kind: 'skill', skill: 'superpowers:systematic-debugging', at: AT }, state('exec'))).toEqual(empty)
  expect(detect({ kind: 'skill', skill: 'other:brainstorming', at: AT }, null)).toEqual(empty)
  expect(detect({ kind: 'skill', skill: 'constructor', at: AT }, null)).toEqual(empty)
})

// --- report_phase ---

test('detect turns report_phase into phase-reported with the reporting agent', () => {
  const e = tool('mcp__superpowers-statusbar__report_phase', { phase: 'red' }, { agentId: 'a1' })
  expect(detect(e, state('exec')).actions).toEqual([{ type: 'phase-reported', phase: 'red', agentId: 'a1', at: AT }])
  const main = tool('mcp__superpowers-statusbar__report_phase', { phase: 'drafting' })
  expect(detect(main, state('plan')).actions).toEqual([{ type: 'phase-reported', phase: 'drafting', at: AT }])
})

test('detect ignores report_phase with an unknown phase', () => {
  expect(detect(tool('mcp__superpowers-statusbar__report_phase', { phase: 'lunch' }), state('exec'))).toEqual(empty)
  expect(detect(tool('mcp__superpowers-statusbar__report_phase', {}), state('exec'))).toEqual(empty)
})

test('detect ignores events other than stage entries without a run', () => {
  expect(detect(tool('mcp__superpowers-statusbar__report_phase', { phase: 'red' }), null)).toEqual(empty)
  expect(detect({ kind: 'turn-end', answer: 'x', at: AT }, null)).toEqual(empty)
  expect(detect({ kind: 'turn-start', at: AT }, null)).toEqual(empty)
  expect(detect(bash(`bash task-brief ${PLAN_PATH} 1`, `wrote ${WS}/task-1-brief.md: 12 lines`), null)).toEqual(empty)
})

// --- Write ---

test('detect records a spec written during brainstorm', () => {
  const spec = '/repo/docs/superpowers/specs/2026-01-01-recettes-design.md'
  expect(detect(tool('Write', { file_path: spec, content: '# Design' }), state('brainstorm')).actions)
    .toEqual([{ type: 'spec-written', path: spec, at: AT }])
  const design = '/repo/notes/recettes-design.md'
  expect(detect(tool('Write', { file_path: design, content: '# Design' }), state('brainstorm')).actions)
    .toEqual([{ type: 'spec-written', path: design, at: AT }])
  expect(detect(tool('Write', { file_path: spec, content: '# Design' }), state('plan')).actions).toEqual([])
  expect(detect(tool('Write', { file_path: '/repo/specs/notes.txt', content: '' }), state('brainstorm')).actions).toEqual([])
})

test('detect loads a plan written before exec', () => {
  const content = '# Plan\n\n### Task 1: Modèle\n\n- [ ] **Step 1: Test**\n- [ ] **Step 2: Code**\n'
  const e = tool('Write', { file_path: `/repo/${PLAN_PATH}`, content })
  expect(detect(e, state('plan')).actions)
    .toEqual([{ type: 'plan-loaded', path: `/repo/${PLAN_PATH}`, tasks: [{ n: '1', title: 'Modèle', steps: 2 }], at: AT }])
  expect(detect(e, state('exec')).actions).toEqual([])
  expect(detect(tool('Write', { file_path: '/repo/README.md', content: '# Readme' }), state('plan')).actions).toEqual([])
})

// --- Bash scripts ---

test('detect reads the workspace path from sdd-workspace output', () => {
  const e = bash(`bash /home/u/sp/skills/subagent-driven-development/scripts/sdd-workspace ${PLAN_PATH}`, `${WS}\n`)
  expect(detect(e, state('exec', { mode: 'sdd' }))).toEqual({
    actions: [{ type: 'workspace-found', path: WS, planPath: PLAN_PATH, at: AT }],
    reads: [{ role: 'plan', path: PLAN_PATH }, { role: 'ledger', path: `${WS}/progress.md` }],
  })
})

test('detect enters exec on sdd-workspace when the run has not reached it', () => {
  const e = bash(`WS=$(bash scripts/sdd-workspace "${PLAN_PATH}")`, '', { result: { stdout: `noise\n${WS}\n\n`, stderr: '' } })
  const expected = {
    actions: [
      { type: 'stage-entered', stage: 'exec', at: AT },
      { type: 'workspace-found', path: WS, planPath: PLAN_PATH, at: AT },
    ],
    reads: [{ role: 'plan', path: PLAN_PATH }, { role: 'ledger', path: `${WS}/progress.md` }],
  }
  expect(detect(e, null)).toEqual(expected)
  expect(detect(e, state('plan'))).toEqual(expected)
  expect(detect(e, state('final-review')).actions.map(a => a.type)).toEqual(['workspace-found'])
})

test('detect takes the workspace line, not the last one, from sdd-workspace output', () => {
  const command = `bash /home/u/sp/skills/subagent-driven-development/scripts/sdd-workspace ${PLAN_PATH}; git rev-parse HEAD`
  const found = (out: string) => detect(bash(command, out), state('exec', { mode: 'sdd' }))
  const expected = {
    actions: [{ type: 'workspace-found', path: WS, planPath: PLAN_PATH, at: AT }],
    reads: [{ role: 'plan', path: PLAN_PATH }, { role: 'ledger', path: `${WS}/progress.md` }],
  }
  expect(found(`${WS}\n331a016317d6e4d4fdf6594fbee61a7700f0c9a6\n`)).toEqual(expected)
  expect(found(`${WS}/\nfeat/recettes\nREADME.md\npackage.json\nsrc\n`)).toEqual(expected)
  // No workspace line: the plan is still read, no workspace is guessed.
  expect(found('331a016317d6e4d4fdf6594fbee61a7700f0c9a6\n')).toEqual({ actions: [], reads: [{ role: 'plan', path: PLAN_PATH }] })
})

test('detect ignores a failed sdd-workspace', () => {
  expect(detect(bash(`bash scripts/sdd-workspace ${PLAN_PATH}`, 'no such plan file', { isError: true }), null)).toEqual(empty)
})

test('detect starts a task on a successful task-brief', () => {
  const ok = bash(`bash /x/scripts/task-brief ${PLAN_PATH} 3a`, `wrote ${WS}/task-3a-brief.md: 40 lines`)
  expect(detect(ok, state('exec')).actions).toEqual([{ type: 'task-started', task: '3a', at: AT }])
  const failed = bash(`bash /x/scripts/task-brief ${PLAN_PATH} 9`, 'task 9 not found', { isError: true })
  expect(detect(failed, state('exec')).actions).toEqual([])
})

test('detect starts a task on a successful task-start', () => {
  const ok = bash(`/x/executing-plans/scripts/task-start ${PLAN_PATH} 2`, `brief: ${WS}/task-2-brief.md\nbase: 0123abcd`)
  expect(detect(ok, state('exec')).actions).toEqual([{ type: 'task-started', task: '2', at: AT }])
  expect(detect({ ...ok, isError: true }, state('exec')).actions).toEqual([])
})

test('detect verifies a task on task-done from its ledger line', () => {
  const cmd = `/x/scripts/task-done ${PLAN_PATH} 2 0123abcd -- npm test`
  const ok = bash(cmd, '12 passing\nledger: Task 2: complete (commits 0123abc..4567def, tests: npm test → 12 passing)')
  expect(detect(ok, state('exec')).actions).toEqual([{ type: 'task-verified', task: '2', isOk: true, at: AT }])
  const failed = bash(cmd, '1 failing', { isError: true })
  expect(detect(failed, state('exec')).actions).toEqual([{ type: 'task-verified', task: '2', isOk: false, at: AT }])
  expect(detect(bash(`/x/scripts/task-done ${PLAN_PATH} 2`, ''), state('exec')).actions).toEqual([])
})

test('detect notices the workspace removal', () => {
  expect(detect(bash(`rm -rf ${WS}`), state('final-review')).actions).toEqual([{ type: 'workspace-removed', at: AT }])
  expect(detect(bash('rm -rf .superpowers/sdd/recettes/'), state('exec')).actions).toEqual([{ type: 'workspace-removed', at: AT }])
  expect(detect(bash(`rm -rf ${WS}/task-1-brief.md`), state('exec')).actions).toEqual([])
})

test('detect finishes the branch on merge, push or PR during finishing', () => {
  for (const cmd of ['git merge feat/x', 'git push -u origin feat/x', 'cd /repo && gh pr create --fill']) {
    expect(detect(bash(cmd), state('finishing')).actions).toEqual([{ type: 'branch-finished', at: AT }])
  }
  expect(detect(bash('git merge feat/x'), state('exec')).actions).toEqual([])
  expect(detect(bash('git merge-base main HEAD'), state('finishing')).actions).toEqual([])
  expect(detect(bash('git push', 'rejected', { isError: true }), state('finishing')).actions).toEqual([])
})

test('detect rereads the ledger when a tool touches progress.md', () => {
  const s = state('exec', { workspace: WS })
  const read = [{ role: 'ledger', path: `${WS}/progress.md` }]
  expect(detect(tool('Write', { file_path: `${WS}/progress.md`, content: 'Task 1: complete' }), s).reads).toEqual(read)
  expect(detect(tool('Edit', { file_path: `${WS}/progress.md` }), s).reads).toEqual(read)
  expect(detect(bash(`echo "Task 1: complete" >> "${WS}/progress.md"`), s).reads).toEqual(read)
  expect(detect(bash(`echo x >> ${WS}/progress.md`), state('exec')).reads).toEqual([])
  expect(detect(tool('Read', { file_path: `${WS}/progress.md` }), s).reads).toEqual([])
})

// --- Agent ---

test('detect maps an async Implement Task dispatch to a running implementer', () => {
  const e = agent({ description: 'Implement Task 2: Repository', prompt: 'You are implementing Task 2: Repository' }, asyncResult('a1'))
  expect(detect(e, state('exec')).actions).toEqual([
    { type: 'agent-dispatched', agentId: 'a1', role: 'implementer', task: '2', isRunning: true, at: AT },
  ])
})

test('detect reports a completed dispatch with its answer', () => {
  const result = { status: 'completed', agentId: 'r1', content: [{ type: 'text', text: '**Task quality:** Approved' }, { type: 'image' }] }
  const e = agent({ description: 'Review Task 1 (spec + quality)', prompt: 'p' }, result)
  expect(detect(e, state('exec')).actions).toEqual([
    { type: 'agent-dispatched', agentId: 'r1', role: 'reviewer', task: '1', isRunning: false, at: AT },
    { type: 'agent-reported', agentId: 'r1', answer: '**Task quality:** Approved', at: AT },
  ])
})

test('detect recognises re-reviewers, final reviewers and builder checks', () => {
  const role = (input: Record<string, unknown>, s: RunState) => {
    const a = detect(agent(input, asyncResult('x')), s).actions[0]
    return a?.type === 'agent-dispatched' ? { role: a.role, task: a.task, round: a.round } : undefined
  }
  expect(role({ description: 'Re-review Task 2 fix round 3', prompt: '' }, state('exec')))
    .toEqual({ role: 're-reviewer', task: '2', round: 3 })
  expect(role({ description: 'Review code changes', prompt: '' }, state('exec'))).toEqual({ role: 'final-reviewer' })
  expect(role({ description: 'Review code changes', prompt: '' }, state('final-review'))).toEqual({ role: 'final-reviewer' })
  expect(role({ description: 'Review code changes', prompt: '' }, state('plan'))).toEqual({ role: 'other' })
  expect(role({ description: 'Builder check', prompt: 'You are a talented baker. You\'ve been handed a design document' }, state('brainstorm')))
    .toEqual({ role: 'builder-check' })
})

test('detect takes any review dispatched once every task is done as the final review', () => {
  const role = (description: string, s: RunState) => {
    const a = detect(agent({ description, prompt: 'Read the branch and report findings.' }, asyncResult('x')), s).actions[0]
    return a?.type === 'agent-dispatched' ? { role: a.role, task: a.task } : undefined
  }
  const task = (n: string, status: 'active' | 'done') => ({ n, title: n, steps: 1, status, fixRounds: 0, trail: [] })
  const allDone = state('exec', { tasks: [task('1', 'done'), task('2', 'done')] })
  const midExec = state('exec', { tasks: [task('1', 'done'), task('2', 'active')] })
  expect(role('Whole-branch code review', allDone)).toEqual({ role: 'final-reviewer' })
  expect(role('Final REVIEW of text-utils', state('final-review'))).toEqual({ role: 'final-reviewer' })
  expect(role('Whole-branch code review', midExec)).toEqual({ role: 'other' })
  expect(role('Whole-branch code review', state('exec'))).toEqual({ role: 'other' })
  expect(role('Review Task 2 (spec + quality)', midExec)).toEqual({ role: 'reviewer', task: '2' })
  expect(role('Review Task 2 (spec + quality)', allDone)).toEqual({ role: 'reviewer', task: '2' })
  expect(role('Re-review Task 2 fix round 1', allDone)).toEqual({ role: 're-reviewer', task: '2' })
})

test('detect falls back on the first prompt line for the agent role', () => {
  const role = (prompt: string, s: RunState = state('exec')) => {
    const a = detect(agent({ description: 'Task work', prompt }, asyncResult('x')), s).actions[0]
    return a?.type === 'agent-dispatched' ? { role: a.role, task: a.task } : undefined
  }
  expect(role('You are implementing Task 4: Vue\n\nmore')).toEqual({ role: 'implementer', task: '4' })
  expect(role("You are reviewing one task's implementation: first")).toEqual({ role: 'reviewer' })
  expect(role("You are re-reviewing one task's fix round. A previous")).toEqual({ role: 're-reviewer' })
  expect(role('You are a Senior Code Reviewer with expertise')).toEqual({ role: 'final-reviewer' })
  expect(role('You are a Senior Code Reviewer with expertise', state('brainstorm'))).toEqual({ role: 'other' })
  expect(role('Explore the repo\nYou are implementing Task 4: Vue')).toEqual({ role: 'other' })
})

test('detect ignores an Agent call without an agent id', () => {
  expect(detect(agent({ description: 'Implement Task 1: X', prompt: '' }, undefined), state('exec'))).toEqual(empty)
  expect(detect(agent({ description: 'Implement Task 1: X', prompt: '' }, 'Error'), state('exec'))).toEqual(empty)
})

// --- SendMessage, turns, files ---

test('detect resumes a known agent on SendMessage', () => {
  const s = state('exec', { agents: { a1: { role: 'implementer', task: '2', isRunning: false } } })
  expect(detect(tool('SendMessage', { to: 'a1', message: 'fix it' }), s).actions).toEqual([{ type: 'agent-resumed', agentId: 'a1', at: AT }])
  expect(detect(tool('SendMessage', { to: 'zz', message: 'hi' }), s).actions).toEqual([])
})

test('detect maps turn ends to agent reports or main turn ends', () => {
  const s = state('exec')
  expect(detect({ kind: 'turn-end', agentId: 'a1', answer: '**Status:** DONE', at: AT }, s).actions)
    .toEqual([{ type: 'agent-reported', agentId: 'a1', answer: '**Status:** DONE', at: AT }])
  expect(detect({ kind: 'turn-end', answer: 'bye', at: AT }, s).actions).toEqual([{ type: 'turn-ended', at: AT }])
})

test('detect maps turn starts to turn-started', () => {
  expect(detect({ kind: 'turn-start', at: AT }, state('plan')).actions).toEqual([{ type: 'turn-started', at: AT }])
})

test('detect parses plan and ledger files', () => {
  const s = state('exec')
  expect(detect({ kind: 'file', role: 'plan', path: PLAN_PATH, text: '### Task 1: A\n- [ ] **Step 1: x**\n', at: AT }, s).actions)
    .toEqual([{ type: 'plan-loaded', path: PLAN_PATH, tasks: [{ n: '1', title: 'A', steps: 1 }], at: AT }])
  expect(detect({ kind: 'file', role: 'ledger', path: `${WS}/progress.md`, text: 'Task 1: complete (x)\nRuling: r', at: AT }, s).actions)
    .toEqual([{ type: 'ledger-loaded', lines: [{ kind: 'complete', task: '1' }, { kind: 'ruling', text: 'r' }], at: AT }])
})
