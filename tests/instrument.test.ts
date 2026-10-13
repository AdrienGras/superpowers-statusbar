import { test, expect } from 'claude-code/testing'

import type { Action, ReportedPhase, RunState } from '../types'
import { REPORT_TOOL } from '../src/instrument.ts'
import { traceEntry } from '../src/trace.ts'
import { replay } from '../src/detectors/index.ts'
import { reduce } from '../src/reduce.ts'
import { DIRECT_RUN, FILES } from './fixtures/runs.ts'

const ALL_PHASES: readonly ReportedPhase[] = [
  'conversation', 'design-writing', 'builder-check', 'awaiting-approval',
  'drafting', 'self-review', 'red', 'green', 'refactor',
]

test('REPORT_TOOL enum lists every ReportedPhase', () => {
  expect(REPORT_TOOL.name).toBe('report_phase')
  expect(REPORT_TOOL.isDeferred).toBe(false)
  expect(REPORT_TOOL.inputSchema).toEqual({
    type: 'object',
    properties: { phase: { type: 'string', enum: ALL_PHASES } },
    required: ['phase'],
  })
})

test('REPORT_TOOL description names the three skills and words every phase', () => {
  const d = REPORT_TOOL.description
  expect(d).toStartWith('Reports the current superpowers phase to the status bar')
  expect(d).toContain('Call it only while following superpowers\' brainstorming, writing-plans or test-driven-development skill')
  expect(d).toContain('once each time you move into one of the phases below, then carry on')
  expect(d).toContain('It is a signal only: it changes nothing about how you follow the skill')
  expect(d).toContain(`brainstorming:
- \`conversation\`: you are asking questions or playing understanding back
- \`design-writing\`: you are writing the design document
- \`builder-check\`: the builder check subagent is reading the document
- \`awaiting-approval\`: the document is handed over for approval`)
  expect(d).toContain(`writing-plans:
- \`drafting\`: you are writing the plan
- \`self-review\`: you are running the self-review checklist`)
  expect(d).toContain(`test-driven-development:
- \`red\`: you are writing a failing test and watching it fail
- \`green\`: you are writing the minimal code to make it pass
- \`refactor\`: you are cleaning up with the tests green`)
  expect(d.length).toBeLessThan(1500)
})

const must = (s: RunState | null): RunState => {
  if (!s) throw new Error('expected a run')
  return s
}

test('traceEntry carries the current task and its last phase', () => {
  // Direct run up to task 2's `green` report: task 2 is current, its trail ends on `green`.
  const upToGreen = DIRECT_RUN.findLastIndex(e => e.kind === 'tool' && e.input.phase === 'green')
  const s = must(replay(DIRECT_RUN.slice(0, upToGreen + 1), FILES))
  const green: Action = { type: 'phase-reported', phase: 'green', at: 7 }
  expect(traceEntry(green, s)).toEqual({ at: 7, action: 'phase-reported', stage: 'exec', mode: 'direct', task: '2', phase: 'green' })

  // An action naming task 1 reports task 1 and its own last phase, even with task 2 current.
  const verified: Action = { type: 'task-verified', task: '1', isOk: true, at: 8 }
  expect(traceEntry(verified, s)).toMatchObject({ task: '1', phase: 'done' })

  // A wait shows up; no run gives a bare entry.
  const waiting: RunState = { ...s, waiting: { reason: 'blocked', task: '2', since: 9 } }
  expect(traceEntry({ type: 'turn-ended', at: 9 }, waiting)).toMatchObject({ task: '2', waiting: 'blocked' })
  expect(traceEntry({ type: 'turn-started', at: 10 }, null)).toEqual({ at: 10, action: 'turn-started' })
})

test('traceEntry lists the task events the action added, across tasks', () => {
  const upToRefactor = DIRECT_RUN.findIndex(e => e.kind === 'tool' && e.input.phase === 'refactor')
  const before = must(replay(DIRECT_RUN.slice(0, upToRefactor + 1), FILES))
  const verified: Action = { type: 'task-verified', task: '1', isOk: true, at: 11 }
  const after = reduce(before, verified)
  // One action, two events: the entry's `phase` only shows the last, `phases` shows both.
  expect(traceEntry(verified, after, before)).toMatchObject({
    task: '1', phase: 'done', phases: [{ task: '1', phase: 'verify' }, { task: '1', phase: 'done' }],
  })
  // Nothing added, or no previous state given: no `phases`.
  expect(traceEntry({ type: 'turn-ended', at: 12 }, after, after).phases).toBeUndefined()
  expect(traceEntry(verified, after).phases).toBeUndefined()
})
