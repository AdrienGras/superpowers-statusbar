import { test, expect, mock } from 'claude-code/testing'
import type { Engine, Plugin } from 'claude-code/testing'
import type { On } from 'claude-code'

import type { ObservedEvent, RunState } from '../types'
import { messagesToEvents } from '../src/rebuild.ts'
import type { TranscriptMessage } from '../src/rebuild.ts'
import { PLAN, PLAN_TEXT, SDD_RUN, SDD_TASK1_LEDGER, WORKSPACE } from './fixtures/runs.ts'

const SCRIPTS = '/home/dev/.claude/plugins/cache/superpowers-marketplace/superpowers/7.0.0/skills/subagent-driven-development/scripts'

/** Answers `mcp__peek__run` with the mod's stored run. */
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

function engine(on: On) {
  mock.clock(on, { now: 1_000_000 })
  mock.env(on, {})
  on('tool.register', (_$, e) => ({ value: { tool: `mcp__superpowers-statusbar__${e.name}` } }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
}

const start = ($: Engine) => $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })

/** What a transcript holds of the events: one assistant message per tool call, `skill` events as `Skill` calls. */
function transcriptOf(events: readonly ObservedEvent[]): TranscriptMessage[] {
  return events.flatMap((e): TranscriptMessage[] => {
    if (e.kind === 'turn-start' || e.kind === 'turn-end' || e.kind === 'file') return []
    const { tool, input, ...outcome } = e.kind === 'skill'
      ? { tool: 'Skill', input: { skill: e.skill } }
      : e
    const use = e.kind === 'skill' ? { tool, input } : { tool, input, ...('result' in outcome ? { result: outcome.result } : {}), ...('text' in outcome ? { text: outcome.text } : {}) }
    return [{ role: 'assistant', text: '', toolUses: [use] }]
  })
}

test('messagesToEvents turns tool uses into events with unknown time', () => {
  const events = messagesToEvents([
    { role: 'user', text: 'go', toolUses: [] },
    { role: 'assistant', text: 'ok', toolUses: [
      { tool: 'Bash', input: { command: 'ls' }, result: { stdout: 'x' }, text: 'x' },
      { tool: 'Bash', input: { command: 'false' }, text: 'boom', isError: true, agentId: 'a1' },
    ] },
  ])
  expect(events).toStrictEqual([
    { kind: 'tool', tool: 'Bash', input: { command: 'ls' }, result: { stdout: 'x' }, text: 'x', at: 0 },
    { kind: 'tool', tool: 'Bash', input: { command: 'false' }, text: 'boom', isError: true, agentId: 'a1', at: 0 },
  ])
})

test('messagesToEvents emits a skill event for Skill tool uses', () => {
  const skill = { tool: 'Skill', input: { skill: 'superpowers:writing-plans' }, result: { success: true } }
  expect(messagesToEvents([{ role: 'assistant', text: '', toolUses: [skill] }])).toStrictEqual([
    { kind: 'skill', skill: 'superpowers:writing-plans', at: 0 },
    { kind: 'tool', tool: 'Skill', input: { skill: 'superpowers:writing-plans' }, result: { success: true }, at: 0 },
  ])
  expect(messagesToEvents([{ role: 'assistant', text: '', toolUses: [{ ...skill, isError: true }] }])).toHaveLength(1)
})

test('messagesToEvents keeps the agentId of a subagent\'s Skill call', () => {
  const skill = { tool: 'Skill', input: { skill: 'superpowers:finishing-a-development-branch' }, agentId: 'a1' }
  expect(messagesToEvents([{ role: 'assistant', text: '', toolUses: [skill] }])[0])
    .toStrictEqual({ kind: 'skill', skill: 'superpowers:finishing-a-development-branch', agentId: 'a1', at: 0 })
})

test('rebuild of a transcript without superpowers activity stays null', { plugins: [PEEK] }, async ($, on) => {
  engine(on)
  on('session.messages', () => ({ value: [
    { role: 'user', text: 'liste les fichiers', toolUses: [] },
    { role: 'assistant', text: '', toolUses: [
      { tool_use_id: 'u1', tool: 'Bash', input: { command: 'ls' }, result: { stdout: 'a' }, text: 'a' },
      { tool_use_id: 'u2', tool: 'Skill', input: { skill: 'frontend-design' }, text: 'ok' },
    ] },
  ] }))
  await start($)
  expect(await runOf($)).toBeNull()
})

test('a fresh session with no messages adopts nothing', { plugins: [PEEK] }, async ($, on) => {
  engine(on)
  const reads: string[] = []
  on('session.messages', () => ({ value: [] }))
  on('fs.read', (_$, e) => { reads.push(e.path); return { value: PLAN_TEXT } })
  await start($)
  expect(reads).toEqual([])
  expect(await runOf($)).toBeNull()
})

test('rebuild of a mid-run transcript restores the current task', { plugins: [PEEK] }, async ($, on) => {
  engine(on)
  const cut = SDD_RUN.findIndex(e => e.kind === 'tool' && e.tool === 'Agent' && String(e.input.description).startsWith('Implement Task 2')) + 1
  const messages = transcriptOf(SDD_RUN.slice(0, cut)).map(m => ({ ...m, toolUses: m.toolUses.map((u, i) => ({ tool_use_id: `u${i}`, ...u })) }))
  const reads: string[] = []
  on('session.messages', () => ({ value: messages }))
  on('fs.read', (_$, e) => {
    reads.push(e.path)
    if (e.path.endsWith(`/${PLAN}`)) return { value: PLAN_TEXT }
    if (e.path === `${WORKSPACE}/progress.md`) return { value: SDD_TASK1_LEDGER }
    return { deny: `ENOENT: ${e.path}` }
  })
  await start($)
  const s = await runOf($)
  expect(s).toMatchObject({ stage: 'exec', mode: 'sdd', planPath: `/repo/${PLAN}`, workspace: WORKSPACE })
  expect(s?.tasks.map(t => [t.n, t.status])).toEqual([['1', 'done'], ['2', 'active']])
  expect(s?.tasks.every(t => t.startedAt === 0 && (t.status !== 'done' || t.doneAt === 0))).toBe(true)
  expect(reads.some(p => p.endsWith(`/${PLAN}`))).toBe(true)
  expect(reads).toContain(`${WORKSPACE}/progress.md`)
})

test('no background agent survives a resume: the next main turn end waits', { plugins: [PEEK] }, async ($, on) => {
  engine(on)
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  const cut = SDD_RUN.findIndex(e => e.kind === 'tool' && e.tool === 'Agent' && String(e.input.description).startsWith('Implement Task 2')) + 1
  const messages = transcriptOf(SDD_RUN.slice(0, cut)).map(m => ({ ...m, toolUses: m.toolUses.map((u, i) => ({ tool_use_id: `u${i}`, ...u })) }))
  on('session.messages', () => ({ value: messages }))
  on('fs.read', (_$, e) => {
    if (e.path.endsWith(`/${PLAN}`)) return { value: PLAN_TEXT }
    if (e.path === `${WORKSPACE}/progress.md`) return { value: SDD_TASK1_LEDGER }
    return { deny: `ENOENT: ${e.path}` }
  })
  await start($)
  const s = await runOf($)
  expect(Object.keys(s?.agents ?? {})).toContain('impl-2')
  expect(Object.values(s?.agents ?? {}).some(r => r.isRunning)).toBe(false)
  await $.turn.complete({ answer: 'Où en est-on ?', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' })
  expect((await runOf($))?.waiting).toMatchObject({ reason: 'other' })
})

test('a run already stored is not rebuilt', { plugins: [PEEK] }, async ($, on) => {
  engine(on)
  on('skill.prompt', (_$, e) => ({ text: e.text }))
  let asked = false
  on('session.messages', () => { asked = true; return { value: [] } })
  await $.skill.prompt({ skill: 'superpowers:brainstorming', text: 'x' })
  await start($)
  expect(asked).toBe(false)
  expect((await runOf($))?.stage).toBe('brainstorm')
})
