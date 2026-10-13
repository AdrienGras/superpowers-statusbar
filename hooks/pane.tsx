// Follows the engine's two rules spelled out at the top of register.tsx: this hook is passed to `on` by reference,
// and reads the run through an atom declared here.

import { atom, read } from 'claude-code'
import type { MatchedHook } from 'claude-code'

import type { Decision, TaskState } from '../types'
import { paneModel } from '../src/view.ts'
import type { PaneModel } from '../src/view.ts'

/** The pane's id, for `$.ui.open`, `$.ui.close` and the `ui.render` matcher. */
export const PANE_ID = 'sp-progress'
export const PANE_TITLE = 'superpowers'

const runAtom = atom({ plugin: 'superpowers-statusbar', key: 'run' } as const, null)

const STAGE_MARKS: Record<PaneModel['stages'][number]['status'], string> = { done: '✓', active: '●', todo: '○', skipped: '–' }
const TASK_MARKS: Record<TaskState['status'], string> = { done: '✓', active: '●', todo: '○' }
const DECISION_LABELS: Record<Decision['kind'], string> = { ruling: 'Ruling', minor: 'minor', parked: 'parked' }

const stageLine = (s: PaneModel['stages'][number]) => `${STAGE_MARKS[s.status]} ${s.label}${s.detail ? ` · ${s.detail}` : ''}`

const taskLine = (t: PaneModel['tasks'][number]) =>
  [`${TASK_MARKS[t.status]} ${t.n}. ${t.title}`, t.duration, t.fixRounds > 0 ? `fix ${t.fixRounds}` : undefined]
    .filter(part => part !== undefined).join(' · ')

const decisionLine = (d: Decision) => `${DECISION_LABELS[d.kind]}${d.task ? ` · Task ${d.task}` : ''} · ${d.text}`

/**
 * Draws the run in the pane, in five blocks (stages, tasks, current task, decisions, estimate), each left out
 * when it has nothing to show; the task list fits the surface's height.
 */
export const renderPane: MatchedHook<'ui.render', { component: 'Pane', requestId: 'sp-progress' }> = async ($, e) => {
  const { Box, Text } = $.ui.resolve(e)
  const run = await read($, runAtom)
  if (run === null) return <Box><Text dimColor>Aucun run superpowers.</Text></Box>
  const m = paneModel(run, await $.clock.now(), e.viewport?.rows ?? 24)
  const block = (title: string, lines: string[]) => (
    <Box flexDirection="column" marginTop={1}>
      <Text bold>{title}</Text>
      {lines.map(line => <Text>{line}</Text>)}
    </Box>
  )
  const tasks = m.tasks.map(taskLine)
  if (m.hiddenTasks > 0) tasks.push(`(+${m.hiddenTasks})`)
  return (
    <Box flexDirection="column" width={e.props.bodyColumns}>
      <Text bold>{m.elapsed ? `${m.title} · ${m.elapsed}` : m.title}</Text>
      {block('ÉTAPES', m.stages.map(stageLine))}
      {tasks.length > 0 && block('TÂCHES', tasks)}
      {m.current && block('TÂCHE EN COURS', [`Task ${m.current.n} · ${m.current.trail.join(' → ')}`])}
      {m.decisions.length > 0 && block('DÉCISIONS & MIS DE CÔTÉ', m.decisions.map(decisionLine))}
      {m.eta && block('ESTIMATION', [m.eta])}
    </Box>
  )
}
