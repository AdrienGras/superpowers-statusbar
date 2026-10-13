import { test, expect } from 'claude-code/testing'

import type { Action, ReportedPhase, RunState } from '../types'
import { instrumentSkill, PHASES_BY_SKILL, REPORT_TOOL } from '../src/instrument.ts'
import { traceEntry } from '../src/trace.ts'
import { replay } from '../src/detectors/index.ts'
import { DIRECT_RUN, FILES } from './fixtures/runs.ts'

const SKILL_TEXT = '---\nname: brainstorming\n---\n\n# Brainstorming\n\nAsk one question at a time.\n'

const HEADER = '## Progress reporting (superpowers-statusbar)'
const INTRO = 'A status bar is tracking this run for your human partner. Each time you move into one of the phases below, '
  + 'call the tool `mcp__superpowers-statusbar__report_phase` once with that phase, then carry on. It is a signal only: '
  + 'it changes nothing about how you follow this skill, and you report nothing else.'

const ALL_PHASES: readonly ReportedPhase[] = [
  'conversation', 'design-writing', 'builder-check', 'awaiting-approval',
  'drafting', 'self-review', 'red', 'green', 'refactor',
]

test('instrumentSkill appends the reporting section to the three skills only', () => {
  expect(instrumentSkill('brainstorming', SKILL_TEXT)).toEndWith(`${HEADER}

${INTRO}

- \`conversation\`: you are asking questions or playing understanding back
- \`design-writing\`: you are writing the design document
- \`builder-check\`: the builder check subagent is reading the document
- \`awaiting-approval\`: the document is handed over for approval
`)
  expect(instrumentSkill('writing-plans', SKILL_TEXT)).toEndWith(`${INTRO}

- \`drafting\`: you are writing the plan
- \`self-review\`: you are running the self-review checklist
`)
  expect(instrumentSkill('test-driven-development', SKILL_TEXT)).toEndWith(`${INTRO}

- \`red\`: you are writing a failing test and watching it fail
- \`green\`: you are writing the minimal code to make it pass
- \`refactor\`: you are cleaning up with the tests green
`)
  for (const other of ['subagent-driven-development', 'executing-plans', 'superpowers:brainstorming', 'commit', '']) {
    expect(instrumentSkill(other, SKILL_TEXT)).toBe(SKILL_TEXT)
  }
})

test('instrumentSkill keeps the original text as a prefix', () => {
  for (const skill of Object.keys(PHASES_BY_SKILL)) {
    for (const text of [SKILL_TEXT, SKILL_TEXT.trimEnd(), '', 'no trailing newline\n\n\n']) {
      const out = instrumentSkill(skill, text)
      expect(out).toStartWith(text)
      expect(out.slice(text.length)).toContain(HEADER)
      expect(out.split(HEADER)).toHaveLength(2)
    }
  }
})

test('REPORT_TOOL enum lists every ReportedPhase', () => {
  expect(REPORT_TOOL.name).toBe('report_phase')
  expect(REPORT_TOOL.isDeferred).toBe(false)
  expect(REPORT_TOOL.description)
    .toBe('Reports the current superpowers phase to the status bar. Call it only when a skill\'s "Progress reporting" section asks you to.')
  expect(REPORT_TOOL.inputSchema).toEqual({
    type: 'object',
    properties: { phase: { type: 'string', enum: ALL_PHASES } },
    required: ['phase'],
  })
  expect(Object.values(PHASES_BY_SKILL).flat().sort()).toEqual([...ALL_PHASES].sort())
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
