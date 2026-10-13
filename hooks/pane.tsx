// Follows the engine's two rules spelled out at the top of register.tsx: this hook is passed to `on` by reference,
// and reads the run through an atom declared here.

import { atom, read } from 'claude-code'
import type { MatchedHook, RenderChildren, TextProps } from 'claude-code'

import type { Decision } from '../types'
import { paneModel } from '../src/view.ts'
import type { Mark } from '../src/view.ts'
import { TONES } from './band.tsx'
import { canSpin } from './spin.ts'

/** The pane's id, for `$.ui.open`, `$.ui.close` and the `ui.render` matcher. */
export const PANE_ID = 'sp-progress'
export const PANE_TITLE = 'superpowers'

const runAtom = atom({ plugin: 'superpowers-statusbar', key: 'run' } as const, null)

const MARKS: Record<Mark, string> = { done: '✓', active: '●', todo: '○', skipped: '–' }
/** A line's colour by where it stands: done, under way, not started (default text), skipped. */
const STATUS_TONES: Record<Mark, TextProps> = { done: TONES.ok, active: TONES.active, todo: TONES.normal, skipped: TONES.subtle }
const DECISION_LABELS: Record<Decision['kind'], string> = { ruling: 'Ruling', minor: 'minor', parked: 'parked' }
/** Where a milestone sits under its stage's label: past the mark and its space. */
const MILESTONE_INDENT = '  '

const decisionTag = (d: Decision) => `${DECISION_LABELS[d.kind]}${d.task ? ` · Task ${d.task}` : ''} · `

/**
 * Draws the run in the pane, in five blocks (stages, tasks, current task, decisions, estimate), each left out
 * when it has nothing to show; the task list fits the surface's height. One line per stage, task and phase of the
 * current task: its mark and label in the colour of where it stands, details in `subtle`, a finished one's duration
 * on the right edge; what is under way turns a spinner (`./spinner.tsx`) where the surface animates one.
 */
export const renderPane: MatchedHook<'ui.render', { component: 'Pane', requestId: 'sp-progress' }> = async ($, e) => {
  const table = $.ui.resolve(e)
  const { Box, Text } = table
  const Client = 'Client' in table && canSpin(e.surface) ? table.Client : undefined
  const run = await read($, runAtom)
  if (run === null) return <Box><Text {...TONES.subtle}>No superpowers run yet.</Text></Box>
  const columns = e.props.bodyColumns
  const m = paneModel(run, await $.clock.now(), e.viewport?.rows ?? 24)

  const mark = (status: Mark, spinnerKey: string) => status === 'active' && Client
    ? <Client key={spinnerKey} module="./spinner.tsx" props={null} width={1} />
    : <Text {...STATUS_TONES[status]}>{MARKS[status]}</Text>
  /** One line: mark, label, `details` in subtle after it, `right` (a duration) against the right edge. */
  const line = (status: Mark, spinnerKey: string, label: string, details: string[], right?: string) => (
    <Box flexDirection="row" width={columns} justifyContent="space-between">
      <Box flexDirection="row" flexShrink={1}>
        {mark(status, spinnerKey)}
        <Text {...STATUS_TONES[status]} wrap="truncate-end">{` ${label}`}</Text>
        {details.map(d => <Text {...TONES.subtle} wrap="truncate-end">{` · ${d}`}</Text>)}
      </Box>
      {right !== undefined && <Box flexShrink={0}><Text {...TONES.subtle}>{` ${right}`}</Text></Box>}
    </Box>
  )
  const block = (title: string, lines: RenderChildren[]) => (
    <Box flexDirection="column" marginTop={1}>
      <Text bold>{title}</Text>
      {lines}
    </Box>
  )

  const stages = m.stages.flatMap(g => [
    line(g.status, 'stage-spinner', g.label, g.detail ? [g.detail] : [], g.duration),
    ...g.milestones.map(label => <Text {...TONES.subtle}>{`${MILESTONE_INDENT}${label}`}</Text>),
  ])
  const tasks = m.tasks.map(t =>
    line(t.status, `task-spinner-${t.n}`, `${t.n}. ${t.title}`, t.fixRounds > 0 ? [`fix ${t.fixRounds}`] : [], t.duration))
  if (m.hiddenTasks > 0) tasks.push(<Text {...TONES.subtle}>{`(+${m.hiddenTasks})`}</Text>)
  const current = m.current && [
    <Text>{`Task ${m.current.n} · ${m.current.title}`}</Text>,
    ...m.current.trail.map(p => line(p.status, 'phase-spinner', p.label, p.verdict ? [p.verdict] : [])),
  ]
  const decisions = m.decisions.map(d => (
    <Box flexDirection="row" width={columns}>
      <Box flexShrink={0}><Text {...TONES.subtle}>{decisionTag(d)}</Text></Box>
      <Text>{d.text}</Text>
    </Box>
  ))
  const eta = m.eta && (
    <Box flexDirection="row">
      {m.eta.split(' · ').flatMap((part, i) => [...(i > 0 ? [<Text {...TONES.subtle}> · </Text>] : []), <Text>{part}</Text>])}
    </Box>
  )
  return (
    <Box flexDirection="column" width={columns}>
      <Box flexDirection="row">
        <Text bold>{m.title}</Text>
        {m.elapsed && <Text {...TONES.subtle}>{` · ${m.elapsed}`}</Text>}
      </Box>
      {block('STAGES', stages)}
      {tasks.length > 0 && block('TASKS', tasks)}
      {current && block('CURRENT TASK', current)}
      {decisions.length > 0 && block('DECISIONS & SET ASIDE', decisions)}
      {eta && block('ESTIMATE', [eta])}
    </Box>
  )
}
