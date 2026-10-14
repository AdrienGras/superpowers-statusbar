import { test, expect } from 'claude-code/testing'

import type { ObservedEvent, RunState, TraceEntry } from '../types'
import { detect } from '../src/detectors/index.ts'
import { reduce } from '../src/reduce.ts'
import { traceEntry } from '../src/trace.ts'
import { checkTrace } from '../src/e2e.ts'
import { SDD_RUN, DIRECT_RUN, FILES } from './fixtures/runs.ts'

/** The trace the mod writes for `events`: detect + reduce, one `traceEntry` per action, file reads served from FILES. */
function traceOf(events: readonly ObservedEvent[]): TraceEntry[] {
  let s: RunState | null = null
  const out: TraceEntry[] = []
  const reads = new Map<string, number>()
  const contentOf = (path: string): string | undefined => {
    const entry = FILES[path]
    if (entry === undefined || typeof entry === 'string') return entry
    const k = reads.get(path) ?? 0
    reads.set(path, k + 1)
    return entry[Math.min(k, entry.length - 1)]
  }
  const apply = (e: ObservedEvent) => {
    const d = detect(e, s)
    for (const a of d.actions) {
      const prev: RunState | null = s
      s = reduce(s, a)
      out.push(traceEntry(a, s, prev))
    }
    for (const r of d.reads) {
      const text = contentOf(r.path)
      if (text !== undefined) apply({ kind: 'file', role: r.role, path: r.path, text, at: e.at })
    }
  }
  for (const e of events) apply(e)
  return out
}

/** A run cut right after the turn that ends on the finishing menu, where `claude -p` exits. */
const untilFinishingMenu = (run: readonly ObservedEvent[]) =>
  run.slice(0, run.findIndex(e => e.kind === 'turn-end' && !e.agentId && /terminée/.test(e.answer)) + 1)

const ok = { errors: [], warnings: [] }

/** The trace without the model's own `report_phase` entries, as in a run where it never reports. */
const unreported = (trace: readonly TraceEntry[]) => trace.filter(e => e.action !== 'phase-reported')

/** The trace with every red and green event of `task` removed from the entries' `phases`. */
const withoutRedGreen = (trace: readonly TraceEntry[], task: string) => trace.map(e =>
  e.phases ? { ...e, phases: e.phases.filter(p => !(p.task === task && (p.phase === 'red' || p.phase === 'green'))) } : e)

test('checkTrace accepts a well-ordered SDD trace', () => {
  expect(checkTrace(traceOf(untilFinishingMenu(SDD_RUN)), 'sdd', 2)).toEqual(ok)
})

test('checkTrace reports a task that skipped review in sdd', () => {
  const trace = traceOf(untilFinishingMenu(SDD_RUN)).map(e =>
    e.phases ? { ...e, phases: e.phases.filter(p => !(p.task === '2' && p.phase === 'review')) } : e)
  expect(checkTrace(trace, 'sdd', 2)).toEqual({ errors: ['task 2: no writing then review before done'], warnings: [] })
})

test('a done task without red then green is an error, in both modes', () => {
  const error = 'task 2: no red then green before done'
  const direct = withoutRedGreen(traceOf(untilFinishingMenu(DIRECT_RUN)), '2')
  expect(checkTrace(direct, 'direct', 2).errors).toContain(error)
  const sdd = withoutRedGreen(traceOf(untilFinishingMenu(SDD_RUN)), '2')
  expect(checkTrace(sdd, 'sdd', 2).errors).toContain(error)
  const swap = { red: 'green', green: 'red' } as const
  const greenFirst = traceOf(untilFinishingMenu(DIRECT_RUN)).map(e => e.phases
    ? { ...e, phases: e.phases.map(p => (p.phase === 'red' || p.phase === 'green' ? { ...p, phase: swap[p.phase] } : p)) }
    : e)
  expect(checkTrace(greenFirst, 'direct', 2).errors).toContain('task 1: no red then green before done')
})

test('red and green observed only give a warning naming the task', () => {
  for (const [run, mode] of [[DIRECT_RUN, 'direct'], [SDD_RUN, 'sdd']] as const) {
    const trace = unreported(traceOf(untilFinishingMenu(run)))
    const { errors, warnings } = checkTrace(trace, mode, 2)
    expect(errors).toEqual([])
    expect(warnings).toContain('task 1: red/green not reported by the model')
  }
})

test('a report of only one phase names what is missing', () => {
  const trace = traceOf(untilFinishingMenu(DIRECT_RUN)).filter(e => !(e.action === 'phase-reported' && e.reported === 'green'))
  expect(checkTrace(trace, 'direct', 2).warnings).toEqual([
    'task 1: red/green not reported by the model (missing green)',
    'task 2: red/green not reported by the model (missing green)',
  ])
})

test('traceEntry records the reported phase', () => {
  const s = reduce(null, { type: 'stage-entered', stage: 'exec', mode: 'direct', at: 0 })
  expect(traceEntry({ type: 'phase-reported', phase: 'green', at: 1 }, s, s).reported).toBe('green')
  expect(traceEntry({ type: 'stage-entered', stage: 'exec', at: 1 }, s, s).reported).toBeUndefined()
})

test('checkTrace requires the final finishing-menu wait once finishing is reached', () => {
  // The full run goes on past the menu: the merge ends it, with no wait.
  expect(checkTrace(traceOf(SDD_RUN), 'sdd', 2))
    .toEqual({ errors: ['the last entry does not wait on finishing-menu (no wait)'], warnings: [] })
})

test('checkTrace requires finishing after final-review', () => {
  const swap = { 'final-review': 'finishing', finishing: 'final-review' } as const
  const finishingFirst = traceOf(untilFinishingMenu(SDD_RUN)).map(e =>
    e.stage === 'final-review' || e.stage === 'finishing' ? { ...e, stage: swap[e.stage] } : e)
  expect(checkTrace(finishingFirst, 'sdd', 2)).toEqual({ errors: ['stage finishing missing after final-review'], warnings: [] })
})

test('checkTrace only warns when the run never reached finishing', () => {
  const removed = SDD_RUN.findIndex(e => e.kind === 'tool' && e.tool === 'Bash' && String(e.input.command).startsWith('rm -rf'))
  expect(checkTrace(traceOf(SDD_RUN.slice(0, removed + 1)), 'sdd', 2))
    .toEqual({ errors: [], warnings: ['run never reached finishing (model behaviour)'] })
})

test('checkTrace reports a run cut during execution', () => {
  const cut = SDD_RUN.findIndex(e => e.kind === 'tool' && e.tool === 'Bash' && String(e.input.command).includes('task-brief') && String(e.input.command).endsWith(' 2'))
  expect(checkTrace(traceOf(SDD_RUN.slice(0, cut)), 'sdd', 2)).toEqual({
    errors: ['stage final-review missing after exec', '1 task(s) done out of 2 expected'],
    warnings: ['run never reached finishing (model behaviour)'],
  })
})

test('checkTrace reports an empty trace', () => {
  expect(checkTrace([], 'sdd', 1)).toEqual({
    errors: ['stage exec missing', '0 task(s) done out of 1 expected'],
    warnings: ['run never reached finishing (model behaviour)'],
  })
})

test('an SDD trace without a spawn-seen dispatch warns', () => {
  const trace = traceOf(untilFinishingMenu(SDD_RUN))
  const via = (v: TraceEntry['via']) => trace.map(e => (e.action === 'agent-dispatched' ? { ...e, via: v } : e))
  const warning = 'no dispatch seen at agent.spawn (tool.call fallback only)'
  expect(checkTrace(via('tool'), 'sdd', 2).warnings).toEqual([warning])
  expect(checkTrace(via('spawn'), 'sdd', 2).warnings).toEqual([])
  const one = via('tool')
  const i = one.findIndex(e => e.action === 'agent-dispatched')
  one[i] = { ...one[i]!, via: 'spawn' }
  expect(checkTrace(one, 'sdd', 2).warnings).toEqual([])
  expect(checkTrace(via('tool'), 'direct', 2).warnings).not.toContain(warning)
})
