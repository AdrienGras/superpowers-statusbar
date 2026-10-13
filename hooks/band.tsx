// Follows the engine's two rules spelled out at the top of register.tsx: this hook is passed to `on` by reference,
// and reads the run through an atom declared here.

import { atom, read } from 'claude-code'
import type { MatchedHook, TextProps } from 'claude-code'

import { bandSegments } from '../src/view.ts'
import type { Tone } from '../src/view.ts'
import { canSpin } from './spin.ts'

const runAtom = atom({ plugin: 'superpowers-statusbar', key: 'run' } as const, null)

/** The theme's colours for each tone, so the band follows the person's theme. */
export const TONES: Record<Tone, TextProps> = {
  normal: {},
  subtle: { color: 'subtle' },
  ok: { color: 'success' },
  active: { color: 'warning' },
  wait: { backgroundColor: 'warning', color: 'inverseText' },
}

/** What the band last read of `e.viewport.isFullscreen`: whether this session's surface docks a pane. */
let isDockingSeen: boolean | undefined

/** True when the last band drawn was on a surface that docks a pane beside the transcript. */
export const isDockingSurface = () => isDockingSeen === true

/**
 * Draws the run as one line above the prompt on the terminal and the desktop, sized to `e.props.bodyColumns`, its
 * running mark a spinner (`./spinner.tsx`) where the surface animates one.
 * Leaves the band to the engine without a run, while a survey holds it, and on the surfaces it does not draw on.
 */
export const renderBand: MatchedHook<'ui.render', { component: 'AbovePrompt' }> = async ($, e, next) => {
  if (e.surface !== 'terminal' && e.surface !== 'desktop') return next(e)
  if (e.viewport?.isFullscreen !== undefined) isDockingSeen = e.viewport.isFullscreen
  if (e.props.hasSurvey) return next(e)
  const run = await read($, runAtom)
  if (run === null) return next(e)
  const columns = e.props.bodyColumns
  const segments = bandSegments(run, await $.clock.now(), columns)
  const table = $.ui.resolve(e)
  const { Box, Text } = table
  const Client = 'Client' in table && canSpin(e.surface) ? table.Client : undefined
  return (
    <Box flexDirection="row" width={columns} height={1}>
      {segments.map(g => g.isSpinner && Client
        ? <Client key="spinner" module="./spinner.tsx" props={null} width={1} />
        : <Text {...TONES[g.tone]} {...(g.isBold ? { bold: true } : {})}>{g.text}</Text>)}
    </Box>
  )
}
