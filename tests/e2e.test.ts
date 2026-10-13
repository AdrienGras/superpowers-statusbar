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

test('checkTrace accepts a well-ordered SDD trace', () => {
  expect(checkTrace(traceOf(untilFinishingMenu(SDD_RUN)), 'sdd', 2)).toEqual([])
})

test('checkTrace reports a task that skipped review in sdd', () => {
  const trace = traceOf(untilFinishingMenu(SDD_RUN)).map(e =>
    e.phases ? { ...e, phases: e.phases.filter(p => !(p.task === '2' && p.phase === 'review')) } : e)
  expect(checkTrace(trace, 'sdd', 2)).toEqual(['tâche 2 : pas de writing puis review avant done'])
})

test('checkTrace requires red then green in direct mode', () => {
  const trace = traceOf(untilFinishingMenu(DIRECT_RUN))
  expect(checkTrace(trace, 'direct', 2)).toEqual([])
  const swap = { red: 'green', green: 'red' } as const
  const greenFirst = trace.map(e => e.phases
    ? { ...e, phases: e.phases.map(p => (p.phase === 'red' || p.phase === 'green' ? { ...p, phase: swap[p.phase] } : p)) }
    : e)
  expect(checkTrace(greenFirst, 'direct', 2)).toEqual(['aucune tâche ne passe par red puis green'])
})

test('checkTrace requires the final finishing-menu wait', () => {
  // The full run goes on past the menu: the merge ends it, with no wait.
  expect(checkTrace(traceOf(SDD_RUN), 'sdd', 2)).toEqual(["la dernière entrée n'attend pas finishing-menu (aucune attente)"])
})

test('checkTrace reports a run cut during execution', () => {
  const cut = SDD_RUN.findIndex(e => e.kind === 'tool' && e.tool === 'Bash' && String(e.input.command).includes('task-brief') && String(e.input.command).endsWith(' 2'))
  expect(checkTrace(traceOf(SDD_RUN.slice(0, cut)), 'sdd', 2)).toEqual([
    'étape final-review absente après exec',
    '1 tâche(s) terminée(s) sur 2 attendue(s)',
    "la dernière entrée n'attend pas finishing-menu (aucune attente)",
  ])
})

test('checkTrace reports an empty trace', () => {
  expect(checkTrace([], 'sdd', 1)).toEqual([
    'étape exec absente',
    '0 tâche(s) terminée(s) sur 1 attendue(s)',
    "la dernière entrée n'attend pas finishing-menu (trace vide)",
  ])
})
