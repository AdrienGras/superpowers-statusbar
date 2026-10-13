import { test, expect, mock } from 'claude-code/testing'
import type { ElementQuery, Engine, FoundElement, MockClock, Plugin } from 'claude-code/testing'
import type { On, RenderSurface, RenderViewport } from 'claude-code'

import type { ObservedEvent } from '../types'
import { canSpin, onSpinnerFault, resetSpinnerFaults } from '../hooks/spin.ts'
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
function engine(on: On, files: Record<string, readonly string[]> = FILES) {
  const clock = mock.clock(on, { now: 1_000_000 })
  mock.env(on, {})
  const world = {
    answer: { result: 'ok' } as { result: unknown; text?: string },
    opened: [] as string[],
    closed: [] as string[],
    /** What the engine answers a `ui.open`: placed, not placed (`reason`), or a failure. */
    open: 'placed' as 'placed' | 'narrow' | 'fails',
  }
  const reads = new Map<string, number>()
  on('fs.read', ($, e) => {
    const path = Object.keys(files).find(p => e.path.endsWith(p))
    if (!path) return { deny: `ENOENT: ${e.path}` }
    const n = reads.get(path) ?? 0
    reads.set(path, n + 1)
    const versions = files[path]!
    return { value: versions[Math.min(n, versions.length - 1)]! }
  })
  on('tool.call', () => world.answer)
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('ui.open', ($, e) => {
    world.opened.push(e.id)
    if (world.open === 'fails') return { deny: 'no host' }
    return { value: world.open === 'placed' ? { isPlaced: true } : { isPlaced: false, reason: 'narrow' } }
  })
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
        world.answer = { result: 'ok' }
        await $.tool.call({ tool: 'Skill', skill: e.skill } as unknown as ToolCallArgs)
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

const mountPane = <S extends RenderSurface>($: Engine, surface: S) =>
  $.ui.mount({ plugin: PLUGIN, surface, component: 'Pane', requestId: 'sp-progress', props: paneProps, viewport: DOCKED })

/** The row a line of the pane is drawn in: the outermost Box whose text starts with `start`. */
async function row(ui: { find: (q: ElementQuery) => Promise<FoundElement | undefined> }, start: string) {
  const found = await ui.find({ type: 'Box', text: new RegExp(`^${start.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`) })
  if (!found) throw new Error(`no row starting ${start}`)
  return found
}

const mountBand = <S extends RenderSurface>($: Engine, surface: S, viewport: RenderViewport = DOCKED) =>
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
    expect((await ui.find({ type: 'Text', text: /Task 2/ }))?.props).toEqual({})
    expect(await ui.find({ type: 'Text', text: 'engine' })).toBeUndefined()
    await ui.unmount()
  }
})

test('band and pane move their elapsed time on every minute while the run is quiet', async ($, on) => {
  const { clock, world } = engine(on)
  await replay($, clock, world, MID_TASK_2)
  const elapsed = /^\d+m$/
  const band = await mountBand($, 'terminal')
  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'Pane', requestId: 'sp-progress', props: paneProps, viewport: DOCKED })
  const before = (await band.find({ type: 'Text', text: elapsed }))?.text
  const eta = (await pane.find({ type: 'Text', text: /^ETA / }))?.text
  expect(before).toBeDefined()
  await clock.advance(20 * 60_000)
  const after = (await band.find({ type: 'Text', text: elapsed }))?.text
  expect(after).toBeDefined()
  expect(after).not.toBe(before)
  expect(eta).toBeDefined()
  expect((await pane.find({ type: 'Text', text: /^ETA / }))?.text).not.toBe(eta)
  await band.unmount()
  await pane.unmount()
})

test('band draws one continuous WAITING block in the theme colours when waiting', async ($, on) => {
  const { clock, world } = engine(on)
  await replay($, clock, world, PLAN_READY)
  for (const surface of SURFACES) {
    const ui = await mountBand($, surface)
    expect((await ui.find({ type: 'Text', text: 'WAITING' }))?.props)
      .toEqual({ backgroundColor: 'warning', color: 'inverseText', bold: true })
    const texts = await ui.findAll({ type: 'Text' })
    expect(texts.map(t => t.text).join('')).toBe(' WAITING · plan ready (2 tasks) · pick an execution mode ')
    for (const t of texts) expect(t.props, t.text).toMatchObject({ backgroundColor: 'warning', color: 'inverseText' })
    expect(await ui.find({ type: 'Client' })).toBeUndefined()
    await ui.unmount()
  }
})

test('band spins its running mark in the warning colour on the terminal and the desktop', async ($, on) => {
  const { clock, world } = engine(on)
  await replay($, clock, world, MID_TASK_2)
  for (const surface of SURFACES) {
    const ui = await mountBand($, surface)
    expect(await ui.find({ type: 'Client', key: 'spinner' })).toMatchObject({ props: { module: 'hooks/spinner.tsx' } })
    expect(await ui.find({ type: 'Text', text: '●' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', in: 'spinner' })).toMatchObject({ text: '⠋', props: { color: 'warning' } })
    await ui.advance(100)
    expect((await ui.find({ type: 'Text', in: 'spinner' }))?.text).toBe('⠙')
    await ui.advance(900)
    expect((await ui.find({ type: 'Text', in: 'spinner' }))?.text).toBe('⠋')
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
    expect(await ui.find({ type: 'Text', text: 'WAITING' })).toBeUndefined()
    await ui.unmount()
  }
})

test('pane shows the five block titles for a run with decisions and an estimate', async ($, on) => {
  const { clock, world } = engine(on)
  await replay($, clock, world, MID_TASK_2)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: PLUGIN, surface, component: 'Pane', requestId: 'sp-progress', props: paneProps, viewport: DOCKED })
    for (const title of ['STAGES', 'TASKS', 'CURRENT TASK', 'DECISIONS & SET ASIDE', 'ESTIMATE']) {
      expect(await ui.find({ type: 'Text', text: title }), title).toBeDefined()
    }
    expect(await ui.find({ type: 'Text', text: /^Ruling/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'Task 2 · Repository de recettes' })).toBeDefined()
    await ui.unmount()
  }
})

test('pane shows the last decisions that fit, the count of the others first, and keeps the estimate', async ($, on) => {
  const many = LEDGER_TASK_1 + Array.from({ length: 12 }, (_, i) => `Ruling: decision ${i + 1} — why — cost\n`).join('')
  const { clock, world } = engine(on, { ...FILES, [`${WORKSPACE}/progress.md`]: [LEDGER_FRESH, many] })
  await replay($, clock, world, MID_TASK_2)
  const ui = await $.ui.mount({
    plugin: PLUGIN, surface: 'terminal', component: 'Pane', requestId: 'sp-progress', props: paneProps,
    viewport: { ...DOCKED, rows: 30 },
  })
  const block = await ui.find({ type: 'Box', text: /^DECISIONS & SET ASIDE/ })
  expect(block?.text).toMatch(/^DECISIONS & SET ASIDE\(\+\d+\)Ruling · decision \d+/)
  expect(block?.text).toContain('decision 12')
  expect(block?.text).not.toContain('decision 1 ')
  expect(await ui.find({ type: 'Text', text: /^\(\+\d+\)$/ })).toMatchObject({ props: { color: 'subtle' } })
  expect(await ui.find({ type: 'Text', text: 'ESTIMATE' })).toBeDefined()
  await ui.unmount()
})

test('pane omits the blocks it has nothing for', async ($, on) => {
  const { clock, world } = engine(on)
  await replay($, clock, world, PLAN_READY)
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'Pane', requestId: 'sp-progress', props: paneProps, viewport: DOCKED })
  expect(await ui.find({ type: 'Text', text: 'STAGES' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'TASKS' })).toBeDefined()
  for (const title of ['CURRENT TASK', 'DECISIONS & SET ASIDE', 'ESTIMATE']) {
    expect(await ui.find({ type: 'Text', text: title }), title).toBeUndefined()
  }
  await ui.unmount()
})

test('sp-progress opens then closes the pane', async ($, on) => {
  const { world } = engine(on)
  expect((await $.command.run(SP_PROGRESS)).text).toBe('Progress pane opened.')
  expect((await $.command.run(SP_PROGRESS)).text).toBe('Progress pane closed.')
  expect(world.opened).toEqual(['sp-progress'])
  expect(world.closed).toEqual(['sp-progress'])
})

test('sp-progress opens again a pane closed by other means', { plugins: [CLOSER] }, async ($, on) => {
  const { world } = engine(on)
  await $.command.run(SP_PROGRESS)
  await $.tool.call({ tool: 'mcp__closer__close' })
  expect((await $.command.run(SP_PROGRESS)).text).toBe('Progress pane opened.')
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

test('pane draws one line per stage, mark and label in the colour of where it stands, durations on the right', async ($, on) => {
  const { clock, world } = engine(on)
  await replay($, clock, world, MID_TASK_2)
  for (const surface of SURFACES) {
    const ui = await mountPane($, surface)
    const done = await row(ui, '✓ brainstorming')
    expect(done).toMatchObject({ props: { flexDirection: 'row', width: 50, justifyContent: 'space-between' } })
    expect(done.text).toMatch(/^✓ brainstorming \d+m$/)
    expect(done.children).toMatchObject([
      { children: [{ props: { color: 'success' }, children: ['✓'] }, { props: { color: 'success' }, children: [' brainstorming'] }] },
      { children: [{ props: { color: 'subtle' } }] },
    ])
    expect(await ui.find({ type: 'Text', text: '  spec written' })).toMatchObject({ props: { color: 'subtle' } })
    expect(await ui.find({ type: 'Text', text: '  2 tasks · 5 steps' })).toMatchObject({ props: { color: 'subtle' } })
    const exec = await row(ui, ' exec SDD')
    expect(exec.children).toMatchObject([{ children: [
      { type: 'Client', props: { key: 'stage-spinner' } }, { props: { color: 'warning' } }, { props: { color: 'subtle' }, children: [' · 1/2'] },
    ] }])
    const todo = await row(ui, '○ final review')
    expect(todo.children).toMatchObject([{ children: [{ type: 'Text', children: ['○'] }, { props: { wrap: 'truncate-end' } }] }])
    expect(JSON.stringify(todo.children)).not.toContain('color')
    expect(todo.text).toBe('○ final review')
    await ui.unmount()
  }
})

test('pane draws tasks and the current task as lists, the running ones spinning', async ($, on) => {
  const { clock, world } = engine(on)
  await replay($, clock, world, MID_TASK_2)
  for (const surface of SURFACES) {
    const ui = await mountPane($, surface)
    const finished = await row(ui, '✓ 1. Modèle Recette')
    expect(finished.text).toMatch(/ \d+m$/)
    expect(finished.props).toMatchObject({ justifyContent: 'space-between' })
    expect((await row(ui, ' 2. Repository de recettes')).children)
      .toMatchObject([{ children: [{ type: 'Client', props: { key: 'task-spinner-2' } }, { props: { color: 'warning' } }] }])
    expect((await row(ui, '✓ brief')).children)
      .toMatchObject([{ children: [{ props: { color: 'success' } }, { props: { color: 'success' } }] }])
    expect((await row(ui, ' implementing')).children)
      .toMatchObject([{ children: [{ type: 'Client', props: { key: 'phase-spinner' } }, { props: { color: 'warning' } }] }])
    expect((await row(ui, '○ review')).text).toBe('○ review')
    expect((await row(ui, '○ done')).text).toBe('○ done')
    expect(await ui.find({ type: 'Text', in: 'phase-spinner' })).toMatchObject({ text: '⠋', props: { color: 'warning' } })
    expect(await ui.find({ type: 'Text', text: 'Ruling · ' })).toMatchObject({ props: { color: 'subtle' } })
    await ui.unmount()
  }
})

test('pane draws a still mark where the surface has no spinner', async ($, on) => {
  const { clock, world } = engine(on)
  await replay($, clock, world, MID_TASK_2)
  for (const surface of ['vscode', 'mobile'] as const) {
    const ui = await mountPane($, surface)
    expect(await ui.find({ type: 'Client' })).toBeUndefined()
    expect((await row(ui, '● implementing')).children)
      .toMatchObject([{ children: [{ props: { color: 'warning' }, children: ['●'] }, { props: { color: 'warning' } }] }])
    await ui.unmount()
  }
})

test('pane holds its active marks still while the run waits', async ($, on) => {
  const { clock, world } = engine(on)
  await replay($, clock, world, PLAN_READY.slice(0, -1))
  const working = await mountPane($, 'terminal')
  expect((await row(working, ' plan')).children)
    .toMatchObject([{ children: [{ type: 'Client', props: { key: 'stage-spinner' } }, { props: { color: 'warning' } }] }])
  await working.unmount()

  await replay($, clock, world, PLAN_READY.slice(-1))
  for (const surface of SURFACES) {
    const ui = await mountPane($, surface)
    expect(await ui.find({ type: 'Client' })).toBeUndefined()
    expect((await row(ui, '● plan')).children)
      .toMatchObject([{ children: [{ props: { color: 'warning' }, children: ['●'] }, { props: { color: 'warning' } }] }])
    await ui.unmount()
  }
})

test('sp-progress does not count a pane that was not placed', async ($, on) => {
  const { world } = engine(on)
  world.open = 'narrow'
  expect((await $.command.run(SP_PROGRESS)).text).toBe('Progress pane cannot be shown here.')
  expect(world.closed).toEqual(['sp-progress'])
  expect((await $.command.run(SP_PROGRESS)).text).toBe('Progress pane cannot be shown here.')
  expect(world.opened).toEqual(['sp-progress', 'sp-progress'])
})

test('entering exec closes a pane the engine did not place', async ($, on) => {
  const { clock, world } = engine(on)
  world.open = 'narrow'
  const band = await mountBand($, 'terminal', DOCKED)
  await band.unmount()
  await replay($, clock, world, MID_TASK_2)
  expect(world.opened).toEqual(['sp-progress'])
  expect(world.closed).toEqual(['sp-progress'])
  world.open = 'placed'
  expect((await $.command.run(SP_PROGRESS)).text).toBe('Progress pane opened.')
})

test('sp-progress answers when opening fails', async ($, on) => {
  const { world } = engine(on)
  world.open = 'fails'
  expect((await $.command.run(SP_PROGRESS)).text).toBe('Progress pane unavailable.')
})

test('the band records the docking surface only on the surfaces it draws on', async ($, on) => {
  const { clock, world } = engine(on)
  const terminal = await mountBand($, 'terminal', { columns: 100, rows: 40, isFullscreen: false })
  await terminal.unmount()
  const vscode = await mountBand($, 'vscode', DOCKED)
  await vscode.unmount()
  await replay($, clock, world, MID_TASK_2)
  expect(world.opened).toEqual([])
})

test('a fault outside the spinner module leaves the spinner alone', async () => {
  // The harness cannot raise `ui.fault` (no `$.ui.fault`), so the hook's rule is tested where it lives.
  const fault = (module: string) => ({ surface: 'terminal', module }) as const
  onSpinnerFault(fault('hooks/other.tsx'))
  expect(canSpin('terminal')).toBe(true)
  onSpinnerFault(fault('hooks/spinner.tsx'))
  expect(canSpin('terminal')).toBe(false)
  resetSpinnerFaults()
})
