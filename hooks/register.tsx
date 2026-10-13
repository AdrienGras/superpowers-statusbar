// Two rules of the engine's scan of this module, which refuses to load it otherwise; band, pane and rebuild follow them:
// - `$` is followed only into functions declared in this file, never across an import: helpers in other files get
//   what `portOf($)` builds (EnginePort), or are hooks passed to `on` by reference.
// - `read`, `update` and `$.state.*` take only an atom or reference written in the file that uses it, never an
//   imported one: each such file declares its own `atom({ plugin: 'superpowers-statusbar', key: 'run' } as const, null)`.
//   Likewise `$.env.get` takes a literal variable name.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, PluginOptions, Register } from 'claude-code'

import type { ObservedEvent } from '../types'

import { REPORT_TOOL } from '../src/instrument.ts'
import { messagesToEvents, stopAgents } from '../src/rebuild.ts'
import { isDockingSurface, renderBand } from './band.tsx'
import { callEvents, toolEvent } from './normalize.ts'
import { PANE_ID, PANE_TITLE, renderPane } from './pane.tsx'
import { observe } from './runtime.ts'
import { spinnerFailed } from './spin.ts'
import type { EnginePort } from './runtime.ts'

/**
 * The run the status bar shows; `null` until a superpowers skill starts one. Declared here: the engine reads
 * state only through an atom or reference written in the file that hooks it, never one imported.
 */
const runAtom = atom({ plugin: 'superpowers-statusbar', key: 'run' } as const, null)

/** Whether the progress pane is open, as `/sp-progress`, the opening at exec and the person's close leave it. */
const paneOpenAtom = atom({ plugin: 'superpowers-statusbar', key: 'isPaneOpen' } as const, false)

const REPORT = 'mcp__superpowers-statusbar__report_phase'
const REPORTED = { result: 'ok' } as const

/** What `observe` reaches of the engine; `$` itself cannot cross into another file. */
function portOf($: EngineInterface): EnginePort {
  return {
    read: () => read($, runAtom),
    update: change => update($, runAtom, change),
    notify: (text, options) => $.ui.notify(text, options),
    tracePath: () => $.env.get('SP_STATUSBAR_TRACE'),
    readFile: path => $.fs.read(path),
    writeFile: (path, text) => $.fs.write(path, text),
    entered: stage => {
      if (stage === 'exec' && isDockingSurface()) void openPane($).catch(() => {})
    },
  }
}

async function openPane($: EngineInterface) {
  await $.ui.open({ id: PANE_ID, title: PANE_TITLE })
  await update($, paneOpenAtom, () => true)
}

/** Whether this copy of the module runs its minute timer; a hot reload cancels the timer with the module it ran in. */
let isTicking = false

/**
 * Starts, once per copy of the module, a timer that redraws the band and the pane every minute while a run is
 * underway, so their elapsed time and estimate move on when no observation writes the run.
 */
function tickEveryMinute($: EngineInterface) {
  if (isTicking) return
  isTicking = true
  try {
    $.clock.every(60_000, () => {
      void read($, runAtom).then(run => {
        if (run && run.stage !== 'done') $.ui.invalidate('ui.render')
      }, () => {})
    })
  } catch {
    isTicking = false
  }
}

/** Observes, in order, the events `events` builds for the current time; neither the clock nor observing fails the hook. */
async function seen($: EngineInterface, events: (at: number) => ObservedEvent | ObservedEvent[], options: PluginOptions) {
  let at: number
  try {
    at = await $.clock.now()
  } catch {
    return
  }
  tickEveryMinute($)
  for (const e of [events(at)].flat()) await observe(portOf($), e, options)
}

/**
 * Rebuilds the run from the session transcript when the session starts with a transcript and no run (a resume).
 * A run already stored (reload, compaction) is kept, and an empty transcript adopts nothing. The events go
 * through `observe` as live ones do, files served by `$.fs.read`, but silently: no notification, trace or pane.
 * Then no agent is left running (`stopAgents`), so the next main turn end can wait. Failing to read the transcript
 * leaves the run as it is.
 */
async function rebuildFromTranscript($: EngineInterface, options: PluginOptions) {
  try {
    if ((await read($, runAtom)) !== null) return
    const messages = await $.session.messages()
    if (!Array.isArray(messages) || messages.length === 0) return
    const port: EnginePort = { ...portOf($), tracePath: async () => undefined, entered: () => {} }
    for (const e of messagesToEvents(messages)) await observe(port, e, { ...options, notifications: false })
    await update($, runAtom, s => s && stopAgents(s))
  } catch {}
}

export const register: Register = (on, options) => {
  on('session.start', async ($, e, next) => {
    await Promise.all([
      $.tool.register(REPORT_TOOL),
      $.command.register({ name: 'sp-progress', description: 'Open or close the superpowers progress pane' }),
    ])
    await rebuildFromTranscript($, options)
    tickEveryMinute($)
    return next(e)
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'sp-progress' }, async $ => {
    if (await read($, paneOpenAtom)) {
      await $.ui.close({ id: PANE_ID })
      await update($, paneOpenAtom, () => false)
      return { text: 'Progress pane closed.' }
    }
    await openPane($)
    return { text: 'Progress pane opened.' }
  })

  on('ui.close', { id: PANE_ID }, async ($, e, next) => {
    const closed = await next(e)
    await update($, paneOpenAtom, () => false)
    return closed
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'AbovePrompt' }, renderBand).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE_ID }, renderPane)

  // A spinner `Client` that failed is left out from then on: the engine draws its site again, with a still mark.
  on('ui.fault', ($, e, next) => {
    spinnerFailed(e.surface)
    return next(e)
  })

  on('skill.prompt', async ($, e, next) => {
    await seen($, at => ({ kind: 'skill', skill: e.skill, at }), options)
    return next(e)
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: REPORT }, async ($, e) => {
    await seen($, at => toolEvent(e, REPORTED, at), options)
    return REPORTED
  }).catch(() => REPORTED)

  on('tool.call', async ($, e, next) => {
    if (e.tool === REPORT) return next(e)
    const ran = await next(e)
    await seen($, at => callEvents(e, ran, at), options)
    return ran
  }).catch(($, e, next) => next(e))

  on('turn.start', async ($, e, next) => {
    const started = await next(e)
    await seen($, at => ({ kind: 'turn-start', at }), options)
    return started
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const completed = await next(e)
    await seen($, at => ({ kind: 'turn-end', ...(e.agentId ? { agentId: e.agentId } : {}), answer: e.answer, at }), options)
    return completed
  }).catch(($, e, next) => next(e))

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') await update($, runAtom, () => null)
    return next(e)
  }).catch(($, e, next) => next(e))
}
