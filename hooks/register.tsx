// Two rules of the engine's scan of this module, which refuses to load it otherwise; band, pane and rebuild follow them:
// - `$` is followed only into functions declared in this file, never across an import: helpers in other files get
//   what `portOf($)` builds (EnginePort), or are hooks passed to `on` by reference.
// - `read`, `update` and `$.state.*` take only an atom or reference written in the file that uses it, never an
//   imported one: each such file declares its own `atom({ plugin: 'superpowers-statusbar', key: 'run' } as const, null)`.
//   Likewise `$.env.get` takes a literal variable name.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, PluginOptions, Register } from 'claude-code'

import type { ObservedEvent, RunState } from '../types'

import { REPORT_TOOL } from '../src/instrument.ts'
import { messagesToEvents, stopAgents } from '../src/rebuild.ts'
import { isDockingSurface, renderBand } from './band.tsx'
import { callEvents, spawnEvent, toolEvent } from './normalize.ts'
import { PANE_ID, PANE_TITLE, renderPane } from './pane.tsx'
import { observe, resetTrace } from './runtime.ts'
import { onSpinnerFault } from './spin.ts'
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

/**
 * Opens the progress pane and tells whether the engine placed it. A pane it left undrawn (a terminal too narrow:
 * 144 columns unasked, 110 once asked) is closed again and not counted open.
 */
async function openPane($: EngineInterface): Promise<boolean> {
  const opened = await $.ui.open({ id: PANE_ID, title: PANE_TITLE })
  if (!opened.isPlaced) {
    await $.ui.close({ id: PANE_ID })
    await update($, paneOpenAtom, () => false)
    return false
  }
  await update($, paneOpenAtom, () => true)
  return true
}

const TICK_MS = 60_000
/** A timer silent for longer than this is taken as ended (the engine ends an interval whose period it refused). */
const TICK_STALE_MS = 3 * TICK_MS

/** The timer this copy of the module runs (a hot reload cancels it with the module it ran in), and when it last ticked or began. */
let timer: { cancel: () => void } | undefined
let lastTick = 0

/**
 * Keeps, once per copy of the module, a timer that redraws the band and the pane every minute while a run is
 * underway, so their elapsed time and estimate move on when no observation writes the run. A timer that has not
 * ticked for more than 3 minutes has ended: it is cancelled and started again.
 */
function tickEveryMinute($: EngineInterface, now: number) {
  if (timer) {
    if (now - lastTick <= TICK_STALE_MS) return
    try { timer.cancel() } catch {}
    timer = undefined
  }
  lastTick = now
  try {
    timer = $.clock.every(TICK_MS, () => {
      void $.clock.now().then(at => { lastTick = at }, () => {})
      void read($, runAtom).then(run => {
        if (run && run.stage !== 'done') $.ui.invalidate('ui.render')
      }, () => {})
    })
  } catch {
    timer = undefined
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
  tickEveryMinute($, at)
  for (const e of [events(at)].flat()) await observe(portOf($), e, options)
}

/**
 * Rebuilds the run from the session transcript when the session starts with a transcript and no run (a resume).
 * A run already stored (reload, compaction) is kept, and an empty transcript adopts nothing. The events go
 * through `observe` as live ones do, files served by `$.fs.read`, but on a local run, apart from the stored one and
 * silent: no notification, trace or pane. Only when the whole replay succeeded is the run stored, once, and only
 * if none was stored meanwhile; then no agent is left running (`stopAgents`), so the next main turn end can wait.
 * Failing to read or replay the transcript leaves the run as it is.
 */
async function rebuildFromTranscript($: EngineInterface, options: PluginOptions) {
  try {
    if ((await read($, runAtom)) !== null) return
    const messages = await $.session.messages()
    if (!Array.isArray(messages) || messages.length === 0) return
    const events = messagesToEvents(messages)
    let rebuilt: RunState | null = null
    const port: EnginePort = {
      read: async () => rebuilt,
      update: async change => { rebuilt = change(rebuilt) },
      notify: async () => {},
      tracePath: async () => undefined,
      readFile: path => $.fs.read(path),
      writeFile: async () => {},
      entered: () => {},
    }
    for (const e of events) await observe(port, e, { ...options, notifications: false })
    const run = rebuilt as RunState | null
    if (run) await update($, runAtom, s => s ?? stopAgents(run))
  } catch {}
}

export const register: Register = (on, options) => {
  on('session.start', async ($, e, next) => {
    await Promise.all([
      $.tool.register(REPORT_TOOL),
      $.command.register({ name: 'sp-progress', description: 'Open or close the superpowers progress pane' }),
    ])
    await rebuildFromTranscript($, options)
    try { tickEveryMinute($, await $.clock.now()) } catch {}
    return next(e)
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'sp-progress' }, async $ => {
    if (await read($, paneOpenAtom)) {
      await $.ui.close({ id: PANE_ID })
      await update($, paneOpenAtom, () => false)
      return { text: 'Progress pane closed.' }
    }
    return { text: await openPane($) ? 'Progress pane opened.' : 'Progress pane cannot be shown here.' }
  }).catch(() => ({ text: 'Progress pane unavailable.' }))

  // A skill typed as `/superpowers:…` reaches `command.run`; the security plugin bypasses `skill.prompt`, which has no agentId.
  on('command.run', async ($, e, next) => {
    if (e.command !== 'sp-progress') await seen($, at => ({ kind: 'command', command: e.command, at }), options)
    return next(e)
  }).catch(($, e, next) => next(e))

  on('ui.close', { id: PANE_ID }, async ($, e, next) => {
    const closed = await next(e)
    await update($, paneOpenAtom, () => false)
    return closed
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'AbovePrompt' }, renderBand).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE_ID }, renderPane)

  // A spinner `Client` that failed is left out from then on: the engine draws its site again, with a still mark.
  on('ui.fault', ($, e, next) => {
    onSpinnerFault(e)
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

  on('agent.spawn', async ($, e, next) => {
    const r = await next(e)
    // Only the model's own Agent tool starts a superpowers dispatch: another plugin's `$.agent.spawn` is not one.
    if (next.origin.plugin !== 'engine') return r
    await seen($, at => spawnEvent(e, r, at) ?? [], options)
    return r
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
    if (e.reason === 'clear') {
      resetTrace()
      await update($, runAtom, () => null)
    }
    return next(e)
  }).catch(($, e, next) => next(e))
}
