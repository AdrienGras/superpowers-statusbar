import { test, expect, mock } from 'claude-code/testing'
import type { Engine, Plugin } from 'claude-code/testing'
import type { On } from 'claude-code'

import type { RunState, TraceEntry } from '../types'
import { instrumentSkill, REPORT_TOOL } from '../src/instrument.ts'
import { skillName, toolEvent } from '../hooks/normalize.ts'
import { observe } from '../hooks/runtime.ts'
import type { EnginePort } from '../hooks/runtime.ts'
import { replay } from '../src/detectors/index.ts'
import { PLAN, PLAN_TEXT, WORKSPACE } from './fixtures/runs.ts'

const REPORT = 'mcp__superpowers-statusbar__report_phase'
const SCRIPTS = '/home/dev/.claude/plugins/cache/superpowers-marketplace/superpowers/7.0.0/skills/subagent-driven-development/scripts'
const SKILL_TEXT = '# A skill\n\nDo the thing.\n'
const PLAN_READY = 'plan prêt (2 tâches) · choisis le mode d\'exécution'

/** Answers `mcp__peek__run` with the mod's run, read the way any plugin reads another's state. */
const PEEK: Plugin = {
  name: 'peek',
  register(on) {
    on('tool.call', { tool: 'mcp__peek__run' }, async $ =>
      ({ result: (await $.state.get({ plugin: 'superpowers-statusbar', key: 'run' })).value ?? null }))
  },
}

async function runOf($: Engine): Promise<RunState | null> {
  return (await $.tool.call({ tool: 'mcp__peek__run' })).result as RunState | null
}

/** The engine beneath the mod: a clock, no environment, and events that hand back what reached them. */
function engine(on: On, env: Record<string, string> = {}) {
  mock.clock(on, { now: 1_000_000 })
  mock.env(on, env)
  on('skill.prompt', ($, e) => ({ text: e.text }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('session.end', ($, e) => ({ sessionId: e.sessionId }))
}

/** A tool bottom that answers every call with what Bash would print, `out`. */
const shell = (out: string) => ({ result: { stdout: out, stderr: '', interrupted: false }, text: out })

const turnComplete = (answer: string) => ({ answer, durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' as const })

/** Writing-plans, then the plan written, then the main turn ends: the run waits for the execution choice. */
async function planReady($: Engine) {
  await $.skill.prompt({ skill: 'superpowers:writing-plans', text: SKILL_TEXT })
  await $.tool.call({ tool: 'Write', file_path: `/repo/${PLAN}`, content: PLAN_TEXT })
  await $.turn.complete(turnComplete('Plan écrit.'))
}

// --- normalize ---

test('skillName drops the superpowers prefix only', () => {
  expect(skillName('superpowers:brainstorming')).toBe('brainstorming')
  expect(skillName('brainstorming')).toBe('brainstorming')
  expect(skillName('other:brainstorming')).toBe('other:brainstorming')
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
  expect(commands).toEqual([{ name: 'sp-progress', description: 'Ouvre ou ferme le pane de progression superpowers' }])
})

test('skill.prompt for superpowers:writing-plans returns the instrumented text', { plugins: [PEEK] }, async ($, on) => {
  engine(on)
  const r = await $.skill.prompt({ skill: 'superpowers:writing-plans', text: SKILL_TEXT })
  expect(r.text).toBe(instrumentSkill('writing-plans', SKILL_TEXT))
  expect(r.text).toContain('- `drafting`: you are writing the plan')
  expect((await runOf($))?.stage).toBe('plan')

  expect((await $.skill.prompt({ skill: 'brainstorming', text: SKILL_TEXT })).text).toBe(instrumentSkill('brainstorming', SKILL_TEXT))
  expect((await $.skill.prompt({ skill: 'superpowers:systematic-debugging', text: SKILL_TEXT })).text).toBe(SKILL_TEXT)
})

test('report_phase calls are answered by the mod and update the run', { plugins: [PEEK] }, async ($, on) => {
  engine(on)
  const reached: string[] = []
  on('tool.call', ($, e) => { reached.push(e.tool); return { result: 'engine' } })
  await $.skill.prompt({ skill: 'superpowers:brainstorming', text: SKILL_TEXT })
  const r = await $.tool.call({ tool: REPORT, phase: 'awaiting-approval' })
  expect(r).toEqual({ result: 'ok' })
  expect(reached).toEqual([])
  expect((await runOf($))?.stagePhase).toBe('awaiting-approval')
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
  // The engine resolves the relative plan path against the session's working directory.
  expect(reads).toEqual([expect.stringMatching(new RegExp(`^/.+/${PLAN}$`)), `${WORKSPACE}/progress.md`])
  const s = await runOf($)
  expect(s).toMatchObject({ stage: 'exec', workspace: WORKSPACE, planPath: PLAN })
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
  expect((await $.skill.prompt({ skill: 'superpowers:writing-plans', text: SKILL_TEXT })).text)
    .toBe(instrumentSkill('writing-plans', SKILL_TEXT))
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
  await $.skill.prompt({ skill: 'superpowers:brainstorming', text: SKILL_TEXT })
  expect((await runOf($))?.stage).toBe('brainstorm')
  await $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: 's1' } })
  expect(await runOf($)).toBeNull()
})
