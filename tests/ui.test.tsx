import { test, expect, mock } from 'claude-code/testing'
import type { Engine, MockClock, Plugin } from 'claude-code/testing'
import type { On, RenderViewport } from 'claude-code'

import type { ObservedEvent } from '../types'
import { PLAN, PLAN_TEXT, SDD_RUN, SDD_RUN_LEDGER, WORKSPACE } from './fixtures/runs.ts'

const PLUGIN = 'superpowers-statusbar'
const SURFACES = ['terminal', 'desktop'] as const
const SKILL_TEXT = '# A skill\n\nDo the thing.\n'
const COLUMNS = 120
const DOCKED: RenderViewport = { columns: 160, rows: 40, isFullscreen: true }

/** The ledger as the run reads it: header only at `sdd-workspace`, then with its ruling and task 1 complete. */
const LEDGER_FRESH = SDD_RUN_LEDGER.slice(0, SDD_RUN_LEDGER.indexOf('Ruling'))
const LEDGER_TASK_1 = SDD_RUN_LEDGER.slice(0, SDD_RUN_LEDGER.indexOf('Task 2:'))

/** SDD_RUN cut while task 2's implementer writes, the ledger rewritten after task 1. */
const MID_TASK_2: ObservedEvent[] = (() => {
  const cut = SDD_RUN.findIndex(e => e.kind === 'tool' && e.tool === 'Agent' && e.input.description === 'Implement Task 2: Repository de recettes')
  const events = SDD_RUN.slice(0, cut + 1)
  const at = events[events.length - 1]!.at + 1
  return [...events, { kind: 'tool', tool: 'Write', input: { file_path: `${WORKSPACE}/progress.md`, content: LEDGER_TASK_1 }, at }]
})()

/** Up to the plan written and the main turn ended: the run waits for the execution choice. */
const PLAN_READY: ObservedEvent[] = [
  { kind: 'skill', skill: 'superpowers:writing-plans', at: 1_000_000 },
  { kind: 'tool', tool: 'Write', input: { file_path: `/repo/${PLAN}`, content: PLAN_TEXT }, at: 1_060_000 },
  { kind: 'turn-end', answer: 'Plan écrit.', at: 1_120_000 },
]

const FILES: Record<string, readonly string[]> = {
  [PLAN]: [PLAN_TEXT],
  [`${WORKSPACE}/progress.md`]: [LEDGER_FRESH, LEDGER_TASK_1],
}

/**
 * The engine beneath the mod: a clock the replay moves, the files of FILES (successive reads move along each
 * list), tools answering what the replayed call printed, a pane host recording opens and closes, and a band of
 * the engine's own reading `engine`.
 */
function engine(on: On) {
  const clock = mock.clock(on, { now: 1_000_000 })
  mock.env(on, {})
  const world = { answer: { result: 'ok' } as { result: unknown; text?: string }, opened: [] as string[], closed: [] as string[] }
  const reads = new Map<string, number>()
  on('fs.read', ($, e) => {
    const path = Object.keys(FILES).find(p => e.path.endsWith(p))
    if (!path) return { deny: `ENOENT: ${e.path}` }
    const n = reads.get(path) ?? 0
    reads.set(path, n + 1)
    const versions = FILES[path]!
    return { value: versions[Math.min(n, versions.length - 1)]! }
  })
  on('tool.call', () => world.answer)
  on('skill.prompt', ($, e) => ({ text: e.text }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('ui.open', ($, e) => { world.opened.push(e.id); return { value: { isPlaced: true } } })
  on('ui.close', ($, e) => { world.closed.push(e.id); return { value: undefined } })
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  return { clock, world }
}

/** Feeds the observed events to the mod through the engine's own events, the clock set to each one's time. */
async function replay($: Engine, clock: MockClock, world: ReturnType<typeof engine>['world'], events: readonly ObservedEvent[]) {
  for (const e of events) {
    await clock.set(Math.max(clock.now(), e.at))
    switch (e.kind) {
      case 'skill':
        await $.skill.prompt({ skill: e.skill, text: SKILL_TEXT })
        break
      case 'tool':
        world.answer = { result: e.result ?? 'ok', ...(e.text !== undefined ? { text: e.text } : {}) }
        await $.tool.call({ tool: e.tool, ...e.input, ...(e.agentId ? { agentId: e.agentId } : {}) } as ToolCallArgs)
        break
      case 'turn-start':
        await $.turn.start({ text: '', turnId: 't' })
        break
      case 'turn-end':
        await $.turn.complete({ answer: e.answer, durationMs: 1, isAborted: false, turnId: 't', reason: 'answer', ...(e.agentId ? { agentId: e.agentId } : {}) })
        break
      case 'file':
        break
    }
  }
}

/** A replayed call, typed as one tool's: the fixtures name tools by string, the engine takes any. */
type ToolCallArgs = { tool: 'Bash'; command: string }

/** `/sp-progress` typed at the prompt of a fullscreen terminal. */
const SP_PROGRESS = { command: 'sp-progress', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 } } as const

/** Closes the progress pane when its tool is called: a close `/sp-progress` did not make, as the person's close mark. */
const CLOSER: Plugin = {
  name: 'closer',
  register(on) {
    on('tool.call', { tool: 'mcp__closer__close' }, async $ => {
      await $.ui.close({ id: 'sp-progress' })
      return { result: 'closed' }
    })
  },
}

const bandProps = { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: COLUMNS, scroll: { offset: 0, bodyRows: 10 }, view: {} }
const paneProps = { title: 'superpowers', isFocused: false, bodyColumns: 50, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 36 }, view: {} }

const mountBand = ($: Engine, surface: (typeof SURFACES)[number] | 'vscode' | 'mobile', viewport: RenderViewport = DOCKED) =>
  $.ui.mount({ plugin: PLUGIN, surface, component: 'AbovePrompt', props: bandProps, viewport })

test('band draws nothing without a run', async ($, on) => {
  engine(on)
  for (const surface of SURFACES) {
    const ui = await mountBand($, surface)
    expect(await ui.findAll({ type: 'Text' })).toHaveLength(1)
    expect(await ui.find({ type: 'Text', text: 'engine' })).toBeDefined()
    await ui.unmount()
  }
})

test('band draws the running line', async ($, on) => {
  const { clock, world } = engine(on)
  await replay($, clock, world, MID_TASK_2)
  for (const surface of SURFACES) {
    const ui = await mountBand($, surface)
    expect(await ui.find({ type: 'Text', text: /\/2/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Task 2/ })).toMatchObject({ props: { color: 'blue' } })
    expect(await ui.find({ type: 'Text', text: 'engine' })).toBeUndefined()
    await ui.unmount()
  }
})

test('band and pane move their elapsed time on every minute while the run is quiet', async ($, on) => {
  const { clock, world } = engine(on)
  await replay($, clock, world, MID_TASK_2)
  const elapsed = /^\d+ min$/
  const band = await mountBand($, 'terminal')
  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'Pane', requestId: 'sp-progress', props: paneProps, viewport: DOCKED })
  const before = (await band.find({ type: 'Text', text: elapsed }))?.text
  const eta = (await pane.find({ type: 'Text', text: /^moy\./ }))?.text
  expect(before).toBeDefined()
  await clock.advance(20 * 60_000)
  const after = (await band.find({ type: 'Text', text: elapsed }))?.text
  expect(after).toBeDefined()
  expect(after).not.toBe(before)
  expect((await pane.find({ type: 'Text', text: /^moy\./ }))?.text).not.toBe(eta)
  await band.unmount()
  await pane.unmount()
})

test('band draws T\'ATTEND when waiting', async ($, on) => {
  const { clock, world } = engine(on)
  await replay($, clock, world, PLAN_READY)
  for (const surface of SURFACES) {
    const ui = await mountBand($, surface)
    expect(await ui.find({ type: 'Text', text: "T'ATTEND" })).toMatchObject({ props: { bold: true, color: 'black' } })
    await ui.unmount()
  }
})

test('band yields to a survey and to the surfaces it does not draw on', async ($, on) => {
  const { clock, world } = engine(on)
  await replay($, clock, world, PLAN_READY)
  const survey = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'AbovePrompt', props: { ...bandProps, hasSurvey: true }, viewport: DOCKED })
  expect(await survey.find({ type: 'Text', text: 'engine' })).toBeDefined()
  await survey.unmount()
  for (const surface of ['vscode', 'mobile'] as const) {
    const ui = await mountBand($, surface)
    expect(await ui.find({ type: 'Text', text: "T'ATTEND" })).toBeUndefined()
    await ui.unmount()
  }
})

test('pane shows the five block titles for a run with decisions and an estimate', async ($, on) => {
  const { clock, world } = engine(on)
  await replay($, clock, world, MID_TASK_2)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: PLUGIN, surface, component: 'Pane', requestId: 'sp-progress', props: paneProps, viewport: DOCKED })
    for (const title of ['ÉTAPES', 'TÂCHES', 'TÂCHE EN COURS', 'DÉCISIONS & MIS DE CÔTÉ', 'ESTIMATION']) {
      expect(await ui.find({ type: 'Text', text: title }), title).toBeDefined()
    }
    expect(await ui.find({ type: 'Text', text: /^Ruling/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /brief → écriture/ })).toBeDefined()
    await ui.unmount()
  }
})

test('pane omits the blocks it has nothing for', async ($, on) => {
  const { clock, world } = engine(on)
  await replay($, clock, world, PLAN_READY)
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'Pane', requestId: 'sp-progress', props: paneProps, viewport: DOCKED })
  expect(await ui.find({ type: 'Text', text: 'ÉTAPES' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'TÂCHES' })).toBeDefined()
  for (const title of ['TÂCHE EN COURS', 'DÉCISIONS & MIS DE CÔTÉ', 'ESTIMATION']) {
    expect(await ui.find({ type: 'Text', text: title }), title).toBeUndefined()
  }
  await ui.unmount()
})

test('sp-progress opens then closes the pane', async ($, on) => {
  const { world } = engine(on)
  expect((await $.command.run(SP_PROGRESS)).text).toBe('Pane de progression ouvert.')
  expect((await $.command.run(SP_PROGRESS)).text).toBe('Pane de progression fermé.')
  expect(world.opened).toEqual(['sp-progress'])
  expect(world.closed).toEqual(['sp-progress'])
})

test('sp-progress opens again a pane closed by other means', { plugins: [CLOSER] }, async ($, on) => {
  const { world } = engine(on)
  await $.command.run(SP_PROGRESS)
  await $.tool.call({ tool: 'mcp__closer__close' })
  expect((await $.command.run(SP_PROGRESS)).text).toBe('Pane de progression ouvert.')
  expect(world.opened).toEqual(['sp-progress', 'sp-progress'])
})

test('entering exec opens the pane where the band last saw a docking surface', async ($, on) => {
  const { clock, world } = engine(on)
  const band = await mountBand($, 'terminal', DOCKED)
  await band.unmount()
  await replay($, clock, world, MID_TASK_2)
  expect(world.opened).toEqual(['sp-progress'])
})

test('entering exec leaves the pane closed where the band saw no docking surface', async ($, on) => {
  const { clock, world } = engine(on)
  const band = await mountBand($, 'terminal', { columns: 100, rows: 40, isFullscreen: false })
  await band.unmount()
  await replay($, clock, world, MID_TASK_2)
  expect(world.opened).toEqual([])
})
