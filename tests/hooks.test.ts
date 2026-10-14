import { test, expect, mock } from 'claude-code/testing'
import type { Engine, Plugin } from 'claude-code/testing'
import type { On } from 'claude-code'

import type { RunState, TraceEntry } from '../types'
import { REPORT_TOOL } from '../src/instrument.ts'
import { callEvents, spawnEvent, toolEvent } from '../hooks/normalize.ts'
import { observe, resetTrace } from '../hooks/runtime.ts'
import { canSpin, resetSpinnerFaults, spinnerFailed } from '../hooks/spin.ts'
import type { EnginePort } from '../hooks/runtime.ts'
import { replay } from '../src/detectors/index.ts'
import { PLAN, PLAN_TEXT, WORKSPACE } from './fixtures/runs.ts'

const REPORT = 'mcp__superpowers-statusbar__report_phase'
const SCRIPTS = '/home/dev/.claude/plugins/cache/superpowers-marketplace/superpowers/7.0.0/skills/subagent-driven-development/scripts'
const SKILL_TEXT = '# A skill\n\nDo the thing.\n'
const PLAN_READY = 'plan ready (2 tasks) · pick an execution mode'

/** Answers `mcp__peek__run` with the mod's run, read the way any plugin reads another's state. */
const PEEK: Plugin = {
  name: 'peek',
  register(on) {
    on('tool.call', { tool: 'mcp__peek__run' }, async $ =>
      ({ result: (await $.state.get({ plugin: 'superpowers-statusbar', key: 'run' })).value ?? null }))
  },
}

/** A plugin that spawns a subagent the way any plugin may, with a description a dispatch would have. */
const SPAWNER: Plugin = {
  name: 'spawner',
  register(on) {
    on('tool.call', { tool: 'mcp__spawner__go' }, async $ => {
      await $.agent.spawn({ prompt: 'p', description: 'Implement Task 1: Modèle' })
      return { result: {} }
    })
  },
}

async function runOf($: Engine): Promise<RunState | null> {
  return (await $.tool.call({ tool: 'mcp__peek__run' })).result as RunState | null
}

/** The engine beneath the mod: a clock, no environment, and events that hand back what reached them. */
function engine(on: On, env: Record<string, string> = {}) {
  mock.clock(on, { now: 1_000_000 })
  mock.env(on, env)
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('session.end', ($, e) => ({ sessionId: e.sessionId }))
}

/** A tool bottom that answers every call with what Bash would print, `out`. */
const shell = (out: string) => ({ result: { stdout: out, stderr: '', interrupted: false }, text: out })

const turnComplete = (answer: string) => ({ answer, durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' as const })

/** Writing-plans, then the plan written, then the main turn ends: the run waits for the execution choice. */
async function planReady($: Engine) {
  await $.tool.call({ tool: 'Skill', skill: 'superpowers:writing-plans' })
  await $.tool.call({ tool: 'Write', file_path: `/repo/${PLAN}`, content: PLAN_TEXT })
  await $.turn.complete(turnComplete('Plan écrit.'))
}

// --- normalize ---

test('the spinner runs on the terminal and the desktop until it fails there', () => {
  expect(['terminal', 'desktop', 'vscode', 'mobile'].map(s => canSpin(s as 'terminal'))).toEqual([true, true, false, false])
  spinnerFailed('terminal')
  expect(canSpin('terminal')).toBe(false)
  expect(canSpin('desktop')).toBe(true)
  resetSpinnerFaults()
  expect(canSpin('terminal')).toBe(true)
})

test('toolEvent flattens the call into input and keeps the outcome', () => {
  const e = { tool: 'Bash', tool_use_id: 'u1', agentId: 'a1', requestMeta: {}, command: 'ls' } as const
  expect(toolEvent(e, { result: { stdout: 'x' }, text: 'x', ref: 3 }, 5))
    .toStrictEqual({ kind: 'tool', tool: 'Bash', input: { command: 'ls' }, result: { stdout: 'x' }, text: 'x', agentId: 'a1', at: 5 })
  expect(toolEvent({ tool: 'Bash', tool_use_id: 'u2', command: 'false' }, { isError: true, result: 'exit 1', text: 'exit 1' }, 6))
    .toStrictEqual({ kind: 'tool', tool: 'Bash', input: { command: 'false' }, result: 'exit 1', text: 'exit 1', isError: true, at: 6 })
  expect(toolEvent({ tool: 'Bash', tool_use_id: 'u3', command: 'rm -rf /' }, { deny: 'no' }, 7))
    .toStrictEqual({ kind: 'tool', tool: 'Bash', input: { command: 'rm -rf /' }, text: 'no', isError: true, at: 7 })
})

test('a Skill call that ran also yields its skill event, first', () => {
  const e = { tool: 'Skill', tool_use_id: 'u1', skill: 'superpowers:writing-plans' } as const
  expect(callEvents(e, { result: { success: true } }, 4)).toEqual([
    { kind: 'skill', skill: 'superpowers:writing-plans', at: 4 },
    { kind: 'tool', tool: 'Skill', input: { skill: 'superpowers:writing-plans' }, result: { success: true }, at: 4 },
  ])
  expect(callEvents(e, { deny: 'no' }, 4)).toHaveLength(1)
  expect(callEvents({ tool: 'Bash', tool_use_id: 'u2', command: 'ls' }, { result: 'x' }, 4)).toHaveLength(1)
})

test('callEvents keeps the agentId of a subagent\'s Skill call', () => {
  const e = { tool: 'Skill', tool_use_id: 'u1', skill: 'superpowers:finishing-a-development-branch', agentId: 'a1' } as const
  expect(callEvents(e, { result: { success: true } }, 4)[0])
    .toEqual({ kind: 'skill', skill: 'superpowers:finishing-a-development-branch', agentId: 'a1', at: 4 })
})

// --- observe ---

/** A port over one stored run; `race` lands another writer's value between `update`'s read and its write. */
function port(stored: RunState | null, race?: (s: RunState | null) => RunState | null) {
  const world = { stored, notes: [] as string[] }
  const p: EnginePort = {
    read: async () => world.stored,
    update: async change => {
      if (race) {
        change(world.stored)
        world.stored = race(world.stored)
      }
      world.stored = change(world.stored)
      return world.stored
    },
    notify: async text => { world.notes.push(text) },
    tracePath: async () => undefined,
    readFile: async path => { throw new Error(`ENOENT: ${path}`) },
    writeFile: async () => {},
    entered: () => {},
  }
  return { world, port: p }
}

const planned = (): RunState | null => replay([
  { kind: 'skill', skill: 'superpowers:writing-plans', at: 1 },
  { kind: 'tool', tool: 'Write', input: { file_path: `/repo/${PLAN}`, content: PLAN_TEXT }, at: 2 },
])

test('observe keeps a concurrent write and notifies from the pair it replaced', async () => {
  const turnEnd = { kind: 'turn-end', answer: 'Plan écrit.', at: 5 } as const

  const alone = port(planned())
  await observe(alone.port, turnEnd, { notifications: true })
  expect(alone.world.stored?.waiting?.reason).toBe('execution-choice')
  expect(alone.world.notes).toEqual([PLAN_READY])

  // Another observation already put the run in this very wait, and reported a phase: both stay, no second notification.
  const raced = port(planned(), s => s && { ...s, stagePhase: 'self-review', waiting: { reason: 'execution-choice', since: 5 } })
  await observe(raced.port, turnEnd, { notifications: true })
  expect(raced.world.stored).toMatchObject({ stagePhase: 'self-review', waiting: { reason: 'execution-choice', since: 5 } })
  expect(raced.world.notes).toEqual([])
})

test('keeping the branch as-is ends the run with no further notification', async () => {
  const finishing = replay([{ kind: 'skill', skill: 'superpowers:finishing-a-development-branch', at: 1 }])
  const { world, port: p } = port(finishing)
  const events = [
    { kind: 'turn-end', answer: 'What would you like to do?', at: 2 },
    { kind: 'turn-start', at: 3 },
    { kind: 'turn-end', answer: 'Keeping branch feat/x.', at: 4 },
    { kind: 'turn-start', at: 5 },
    { kind: 'turn-end', answer: 'Anything else?', at: 6 },
  ] as const
  for (const e of events) await observe(p, e, { notifications: true })
  expect(world.stored).toMatchObject({ stage: 'done', finishedAt: 4 })
  expect(world.stored?.waiting).toBeUndefined()
  expect(world.notes).toEqual(['ready for your test · finishing menu'])
})

const toMenu = async (p: EnginePort) => {
  const events = [
    { kind: 'turn-end', answer: 'What would you like to do?', at: 2 },
    { kind: 'turn-start', at: 3 },
  ] as const
  for (const e of events) await observe(p, e, { notifications: true })
}

test('the discard confirmation keeps the run until the branch is deleted', async () => {
  const { world, port: p } = port(replay([{ kind: 'skill', skill: 'superpowers:finishing-a-development-branch', at: 1 }]))
  await toMenu(p)
  await observe(p, { kind: 'turn-end', answer: "Type 'discard' to confirm.", at: 4 }, { notifications: true })
  expect(world.stored).toMatchObject({ stage: 'finishing', waiting: { reason: 'other' } })
  expect(world.notes).toEqual(['ready for your test · finishing menu'])
  await observe(p, { kind: 'turn-start', at: 5 }, { notifications: true })
  await observe(p, { kind: 'tool', tool: 'Bash', input: { command: 'git branch -D feat/x' }, at: 6 }, { notifications: true })
  expect(world.stored?.stage).toBe('done')
})

test('a reply that is not a choice keeps the run open', async () => {
  const { world, port: p } = port(replay([{ kind: 'skill', skill: 'superpowers:finishing-a-development-branch', at: 1 }]))
  await toMenu(p)
  await observe(p, { kind: 'turn-end', answer: 'Fixed the tests.', at: 4 }, { notifications: true })
  expect(world.stored).toMatchObject({ stage: 'finishing', waiting: { reason: 'other' } })
})

// --- hooks ---

test('session.start registers the report tool and the command', async ($, on) => {
  engine(on)
  const tools: unknown[] = []
  const commands: unknown[] = []
  on('tool.register', ($, e) => { tools.push(e); return { value: { tool: `mcp__superpowers-statusbar__${e.name}` } } })
  on('command.register', ($, e) => { commands.push(e); return { value: { command: e.name } } })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  expect(tools).toEqual([REPORT_TOOL])
  expect(commands).toEqual([{ name: 'sp-progress', description: 'Open or close the superpowers progress pane' }])
})

test('skill.prompt no longer changes the run and leaves its text alone', { plugins: [PEEK] }, async ($, on) => {
  engine(on)
  on('skill.prompt', ($, e) => ({ text: e.text }))
  const r = await $.skill.prompt({ skill: 'superpowers:writing-plans', text: SKILL_TEXT })
  expect(r.text).toBe(SKILL_TEXT)
  expect(await runOf($)).toBeNull()
})

test('typing /superpowers:writing-plans enters plan and runs the command', { plugins: [PEEK] }, async ($, on) => {
  engine(on)
  on('command.run', () => ({ text: 'core' }))
  const typed = (command: string) => ({ command, args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 } }) as const
  const r = await $.command.run(typed('superpowers:writing-plans'))
  expect(r.text).toBe('core')
  expect((await runOf($))?.stage).toBe('plan')
})

test('/sp-progress still toggles the pane and starts no run', { plugins: [PEEK] }, async ($, on) => {
  engine(on)
  on('command.run', () => ({ text: 'core' }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  const r = await $.command.run({ command: 'sp-progress', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 } })
  expect(r.text).not.toBe('core')
  expect(await runOf($)).toBeNull()
})

test('report_phase calls are answered by the mod and update the run', { plugins: [PEEK] }, async ($, on) => {
  engine(on)
  const reached: string[] = []
  on('tool.call', ($, e) => { reached.push(e.tool); return { result: 'engine' } })
  await $.tool.call({ tool: 'Skill', skill: 'superpowers:brainstorming' })
  const r = await $.tool.call({ tool: REPORT, phase: 'awaiting-approval' })
  expect(r).toEqual({ result: 'ok' })
  expect(reached).toEqual(['Skill'])
  expect((await runOf($))?.stagePhase).toBe('awaiting-approval')
})

test('a Skill call entering the same stage twice enters it once', { plugins: [PEEK] }, async ($, on) => {
  engine(on)
  on('tool.call', () => ({ result: { success: true } }))
  const enter = (skill: string) => $.tool.call({ tool: 'Skill', skill })
  await enter('superpowers:brainstorming')
  const first = await runOf($)
  expect(first?.stage).toBe('brainstorm')
  await enter('superpowers:brainstorming')
  expect(await runOf($)).toEqual(first)

  await enter('superpowers:subagent-driven-development')
  await enter('superpowers:subagent-driven-development')
  const s = await runOf($)
  expect(s).toMatchObject({ id: first?.id, stage: 'exec', mode: 'sdd' })
  expect(s?.milestones.filter(m => m.stage === 'exec')).toHaveLength(1)
})

test('a Bash sdd-workspace call starts exec and reads the plan through $.fs', { plugins: [PEEK] }, async ($, on) => {
  engine(on)
  const reads: string[] = []
  on('fs.read', ($, e) => {
    reads.push(e.path)
    return e.path.endsWith(`/${PLAN}`) ? { value: PLAN_TEXT } : { deny: `ENOENT: ${e.path}` }
  })
  on('tool.call', () => shell(`${WORKSPACE}\n`))
  const ran = await $.tool.call({ tool: 'Bash', command: `bash ${SCRIPTS}/sdd-workspace ${PLAN}` })
  expect(ran.text).toBe(`${WORKSPACE}\n`)
  // The relative plan path is read from the repository root the workspace sits in.
  expect(reads).toEqual([`/repo/${PLAN}`, `${WORKSPACE}/progress.md`])
  const s = await runOf($)
  expect(s).toMatchObject({ stage: 'exec', workspace: WORKSPACE, planPath: `/repo/${PLAN}` })
  expect(s?.tasks.map(t => [t.n, t.title, t.status])).toEqual([['1', 'Modèle Recette', 'todo'], ['2', 'Repository de recettes', 'todo']])
})

test('a wait worth notifying raises one notification titled superpowers', async ($, on) => {
  engine(on)
  on('tool.call', () => ({ result: { type: 'create' } }))
  const notes: unknown[] = []
  on('ui.notify', ($, e) => { notes.push(e); return { value: { isSent: true, channel: 'terminal_bell' } } })
  await planReady($)
  expect(notes).toEqual([{ text: PLAN_READY, title: 'superpowers' }])
})

test('notifications respect the notifications option', { options: { notifications: false } }, async ($, on) => {
  engine(on)
  on('tool.call', () => ({ result: { type: 'create' } }))
  const notes: unknown[] = []
  on('ui.notify', ($, e) => { notes.push(e); return { value: { isSent: true, channel: 'terminal_bell' } } })
  await planReady($)
  expect(notes).toEqual([])
})

test('a failing observer never breaks the tool call', { plugins: [PEEK] }, async ($, on) => {
  engine(on)
  on('state.set', () => ({ deny: 'state is down' }))
  on('fs.read', () => ({ value: PLAN_TEXT }))
  on('tool.call', () => shell(`${WORKSPACE}\n`))
  const ran = await $.tool.call({ tool: 'Bash', command: `bash ${SCRIPTS}/sdd-workspace ${PLAN}` })
  expect(ran).toMatchObject(shell(`${WORKSPACE}\n`))
  expect(ran.isError).toBeUndefined()
  expect(await runOf($)).toBeNull()
  expect(await $.tool.call({ tool: 'Skill', skill: 'superpowers:writing-plans' })).toMatchObject(shell(`${WORKSPACE}\n`))
})

test('the trace file gets one JSON line per action when SP_STATUSBAR_TRACE is set', async ($, on) => {
  engine(on, { SP_STATUSBAR_TRACE: '/tmp/trace.jsonl' })
  on('tool.call', () => ({ result: { type: 'create' } }))
  on('ui.notify', () => ({ value: { isSent: true, channel: 'terminal_bell' } }))
  const writes: { path: string; text: string }[] = []
  on('fs.write', ($, e) => { writes.push(e); return { value: undefined } })
  await planReady($)
  const last = writes[writes.length - 1]
  expect(last?.path).toBe('/tmp/trace.jsonl')
  const entries = (last?.text ?? '').trimEnd().split('\n').map(l => JSON.parse(l) as TraceEntry)
  expect(entries.map(e => [e.action, e.stage, e.waiting])).toEqual([
    ['stage-entered', 'plan', undefined],
    ['plan-loaded', 'plan', undefined],
    ['turn-ended', 'plan', 'execution-choice'],
  ])
})

test('a /clear forgets the run', { plugins: [PEEK] }, async ($, on) => {
  engine(on)
  on('tool.call', () => ({ result: { success: true } }))
  await $.tool.call({ tool: 'Skill', skill: 'superpowers:brainstorming' })
  expect((await runOf($))?.stage).toBe('brainstorm')
  await $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: 's1' } })
  expect(await runOf($)).toBeNull()
})

// --- agent.spawn ---

const SPAWN = { tool_use_id: 'u1', prompt: 'p', description: 'd', subagentType: 'general-purpose', provider: { plugin: 'engine', tier: 'core' }, fork: false, parentModel: 'm', background: true } as const

test('spawnEvent keeps what a dispatch is and ignores workflow and teammate spawns', () => {
  expect(spawnEvent({ ...SPAWN, description: 'Implement Task 1: X', parentAgentId: 'p1' }, { model: 'm', agentId: 'a1' }, 9))
    .toStrictEqual({ kind: 'spawn', agentId: 'a1', description: 'Implement Task 1: X', prompt: 'p', parentAgentId: 'p1', at: 9 })
  expect(spawnEvent(SPAWN, { model: 'm' }, 9)).toBeUndefined()
  expect(spawnEvent({ ...SPAWN, isTeammate: true }, { model: 'm', agentId: 'a1' }, 9)).toBeUndefined()
  expect(spawnEvent({ ...SPAWN, workflow: { runId: 'w' } as never }, { model: 'm', agentId: 'a1' }, 9)).toBeUndefined()
})

/** An exec run with its plan loaded, the engine answering a spawn with `impl-1` and the `Agent` call with what `agent` says. */
async function execWithPlan($: Engine, on: On, agent: unknown) {
  engine(on)
  on('agent.spawn', () => ({ model: 'm', agentId: 'impl-1' }))
  on('fs.read', ($, e) => (e.path.endsWith(`/${PLAN}`) ? { value: PLAN_TEXT } : { deny: `ENOENT: ${e.path}` }))
  on('tool.call', ($, e) => (e.tool === 'Agent' ? { result: agent } : shell(`${WORKSPACE}\n`)))
  await $.tool.call({ tool: 'Bash', command: `bash ${SCRIPTS}/sdd-workspace ${PLAN}` })
}

const trailOf = (s: RunState | null, n: string) => s?.tasks.find(t => t.n === n)?.trail.map(p => p.phase)

test('a foreground dispatch is seen when it starts', { plugins: [PEEK] }, async ($, on) => {
  await execWithPlan($, on, { status: 'completed', agentId: 'impl-1', content: [{ type: 'text', text: '- **Status:** DONE' }] })
  await $.agent.spawn({ ...SPAWN, description: 'Implement Task 1: Modèle' })
  const started = await runOf($)
  expect(trailOf(started, '1')?.at(-1)).toBe('writing')
  expect(started?.agents['impl-1']).toMatchObject({ role: 'implementer', isRunning: true })

  await $.tool.call({ tool: 'Agent', description: 'Implement Task 1: Modèle', prompt: 'p' })
  const done = await runOf($)
  expect(trailOf(done, '1')?.filter(p => p === 'writing')).toHaveLength(1)
  expect(done?.tasks.find(t => t.n === '1')?.lastStatus).toBe('DONE')
})

test('a spawn raised by another plugin is not a dispatch', { plugins: [PEEK, SPAWNER] }, async ($, on) => {
  await execWithPlan($, on, { status: 'async_launched', agentId: 'impl-1' })
  await $.tool.call({ tool: 'mcp__spawner__go' })
  const s = await runOf($)
  expect(s?.agents['impl-1']).toBeUndefined()
  expect(trailOf(s, '1')?.includes('writing')).toBeFalsy()
})

test('a background dispatch seen at spawn and at its call counts once', { plugins: [PEEK] }, async ($, on) => {
  await execWithPlan($, on, { status: 'async_launched', agentId: 'impl-1' })
  await $.agent.spawn({ ...SPAWN, description: 'Implement Task 1: Modèle' })
  await $.tool.call({ tool: 'Agent', description: 'Implement Task 1: Modèle', prompt: 'p' })
  const s = await runOf($)
  expect(trailOf(s, '1')?.filter(p => p === 'writing')).toHaveLength(1)
  expect(s?.agents['impl-1']?.isRunning).toBe(true)
})

test('every trace line says which event produced it', async ($, on) => {
  engine(on, { SP_STATUSBAR_TRACE: '/tmp/trace.jsonl' })
  on('tool.call', () => ({ result: { type: 'create' } }))
  on('ui.notify', () => ({ value: { isSent: true, channel: 'terminal_bell' } }))
  const writes: { path: string; text: string }[] = []
  on('fs.write', ($, e) => { writes.push(e); return { value: undefined } })
  await planReady($)
  const entries = (writes[writes.length - 1]?.text ?? '').trimEnd().split('\n').map(l => JSON.parse(l) as TraceEntry)
  expect(entries.map(e => e.via)).toEqual(['skill', 'tool', 'turn-end'])
})

// --- robustness ---

/** The engine under a rebuild: what `session.start` needs, and `session.messages` answering `messages`. */
function rebuilding(on: On, messages: () => unknown) {
  engine(on)
  on('tool.register', (_$, e) => ({ value: { tool: `mcp__superpowers-statusbar__${e.name}` } }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.messages', async () => ({ value: await messages() as never }))
}
const startSession = ($: Engine) => $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
const TRANSCRIPT = [
  { role: 'assistant', text: '', toolUses: [{ tool: 'Skill', input: { skill: 'superpowers:writing-plans' } }] },
  { role: 'assistant', text: '', toolUses: [{ tool: 'Write', input: { file_path: `/repo/${PLAN}`, content: PLAN_TEXT } }] },
]

test('a rebuild is stored whole, once, or not at all', { plugins: [PEEK] }, async ($, on) => {
  rebuilding(on, () => TRANSCRIPT)
  // The store fails from its second write on: the replay must not have written event by event.
  let writes = 0
  on('state.set', ($, e, next) => (++writes > 1 ? { deny: 'state is down' } : next(e)))
  await startSession($)
  expect((await runOf($))?.tasks).toHaveLength(2)
})

test('a rebuild whose store fails stores nothing', { plugins: [PEEK] }, async ($, on) => {
  rebuilding(on, () => TRANSCRIPT)
  on('state.set', () => ({ deny: 'state is down' }))
  await startSession($)
  expect(await runOf($)).toBeNull()
})

test('a run stored while the transcript is read is kept', { plugins: [PEEK] }, async ($, on) => {
  let live: Promise<unknown> | undefined
  rebuilding(on, async () => {
    live = $.tool.call({ tool: 'Skill', skill: 'superpowers:brainstorming' })
    await live
    return TRANSCRIPT
  })
  on('tool.call', () => ({ result: { success: true } }))
  await startSession($)
  expect((await runOf($))?.stage).toBe('brainstorm')
})

test('a notification that throws synchronously leaves the reads and the trace done', async () => {
  const { port: p, world } = port(planned())
  const written: string[] = []
  const read: string[] = []
  p.notify = () => { throw new Error('sync') }
  p.tracePath = async () => '/tmp/t.jsonl'
  p.writeFile = async (_path, text) => { written.push(text) }
  p.readFile = async path => { read.push(path); return PLAN_TEXT }
  try {
    // The notifying event (a turn end) asks for no file, and none asks for both: the read is fed by the next event, on the same port.
    await observe(p, { kind: 'turn-end', answer: 'Plan écrit.', at: 5 }, { notifications: true })
    expect(world.stored?.waiting?.reason).toBe('execution-choice')
    expect(written).toHaveLength(1)
    expect(written[0]).toContain('turn-ended')
    await observe(p, { kind: 'tool', tool: 'Bash', input: { command: `bash ${SCRIPTS}/sdd-workspace ${PLAN}` }, text: `${WORKSPACE}\n`, at: 6 }, { notifications: true })
    expect(read).toContain(`${WORKSPACE}/progress.md`)
  } finally {
    resetTrace()
  }
})

test('the trace restarts after /clear', async ($, on) => {
  resetTrace()
  engine(on, { SP_STATUSBAR_TRACE: '/tmp/trace.jsonl' })
  on('tool.call', () => ({ result: { success: true } }))
  const writes: string[] = []
  on('fs.write', ($, e) => { writes.push(e.text); return { value: undefined } })
  await $.tool.call({ tool: 'Skill', skill: 'superpowers:brainstorming' })
  expect(writes[writes.length - 1]?.trimEnd().split('\n')).toHaveLength(1)
  await $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: 's1' } })
  await $.tool.call({ tool: 'Skill', skill: 'superpowers:writing-plans' })
  const lines = (writes[writes.length - 1] ?? '').trimEnd().split('\n').map(l => JSON.parse(l) as TraceEntry)
  expect(lines.map(l => l.stage)).toEqual(['plan'])
})

test('the minute timer restarts after its interval ended', async ($, on) => {
  // mock.clock answers clock.every itself, so this test owns the clock: a refused period ends the interval, with no callback.
  let now = 1_000_000
  on('clock.now', () => ({ value: now }))
  mock.env(on, {})
  on('tool.call', () => ({ result: { success: true } }))
  let asked = 0
  on('clock.every', () => {
    asked += 1
    return asked === 1 ? { deny: 'refused period' } : { value: undefined }
  })
  await $.tool.call({ tool: 'Skill', skill: 'superpowers:brainstorming' })
  expect(asked).toBe(1)
  now += 4 * 60_000
  await $.tool.call({ tool: 'Skill', skill: 'superpowers:brainstorming' })
  expect(asked).toBe(2)
})

const flush = async () => { for (let i = 0; i < 50; i++) await Promise.resolve() }

test('trace writes that overlap coalesce into one more write holding every line', async () => {
  resetTrace()
  try {
  const { port: p } = port(null)
  const written: string[] = []
  let release: () => void = () => {}
  p.tracePath = async () => '/tmp/t.jsonl'
  p.writeFile = async (_path, text) => {
    written.push(text)
    if (written.length === 1) await new Promise<void>(r => { release = r })
  }
  const first = observe(p, { kind: 'skill', skill: 'superpowers:writing-plans', at: 1 }, {})
  await flush()
  const others = [
    observe(p, { kind: 'tool', tool: 'Write', input: { file_path: `/repo/${PLAN}`, content: PLAN_TEXT }, at: 2 }, {}),
    observe(p, { kind: 'turn-end', answer: 'Plan écrit.', at: 3 }, {}),
  ]
  await flush()
  release()
  await Promise.all([first, ...others])
  expect(written).toHaveLength(2)
  expect(written[1]?.trimEnd().split('\n').length).toBeGreaterThanOrEqual(2)
  } finally {
    resetTrace()
  }
})
