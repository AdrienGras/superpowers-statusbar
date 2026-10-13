import { atom, read, update } from 'claude-code'
import type { EngineInterface, PluginOptions, Register } from 'claude-code'

import type { ObservedEvent } from '../types'

import { instrumentSkill, REPORT_TOOL } from '../src/instrument.ts'
import { skillName, toolEvent } from './normalize.ts'
import { observe } from './runtime.ts'
import type { EnginePort } from './runtime.ts'

/**
 * The run the status bar shows; `null` until a superpowers skill starts one. Declared here: the engine reads
 * state only through an atom or reference written in the file that hooks it, never one imported.
 */
const runAtom = atom({ plugin: 'superpowers-statusbar', key: 'run' } as const, null)

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
  }
}

/** Observes the event `event` builds for the current time; neither the clock nor the observation fails the hook. */
async function seen($: EngineInterface, event: (at: number) => ObservedEvent, options: PluginOptions) {
  let at: number
  try {
    at = await $.clock.now()
  } catch {
    return
  }
  await observe(portOf($), event(at), options)
}

export const register: Register = (on, options) => {
  on('session.start', async ($, e, next) => {
    await Promise.all([
      $.tool.register(REPORT_TOOL),
      $.command.register({ name: 'sp-progress', description: 'Ouvre ou ferme le pane de progression superpowers' }),
    ])
    return next(e)
  }).catch(($, e, next) => next(e))

  on('skill.prompt', async ($, e, next) => {
    await seen($, at => ({ kind: 'skill', skill: e.skill, at }), options)
    return next({ ...e, text: instrumentSkill(skillName(e.skill), e.text) })
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: REPORT }, async ($, e) => {
    await seen($, at => toolEvent(e, REPORTED, at), options)
    return REPORTED
  }).catch(() => REPORTED)

  on('tool.call', async ($, e, next) => {
    if (e.tool === REPORT) return next(e)
    const ran = await next(e)
    await seen($, at => toolEvent(e, ran, at), options)
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
