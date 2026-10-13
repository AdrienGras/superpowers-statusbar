import type { ObservedEvent, RunState } from '../types'

/** The part of a `SessionMessage` the rebuild reads; structural, so `src/` imports nothing from `'claude-code'`. */
export type TranscriptMessage = {
  role: 'user' | 'assistant'
  text: string
  toolUses: readonly {
    tool: string
    input: Record<string, unknown>
    result?: unknown
    text?: string
    isError?: true
    agentId?: string
  }[]
}

/**
 * The events a session transcript shows the detectors, in order, all at time 0 (unknown). A `Skill` call that
 * did not fail also counts as that skill starting, placed before the call itself: the rule `hooks/normalize.ts`
 * applies live. The transcript keeps no turn boundaries, so no `turn-end` is emitted.
 */
export function messagesToEvents(messages: readonly TranscriptMessage[]): ObservedEvent[] {
  const events: ObservedEvent[] = []
  for (const m of messages) {
    for (const u of m.toolUses) {
      const skill = u.tool === 'Skill' && !u.isError ? u.input.skill : undefined
      if (typeof skill === 'string') events.push({ kind: 'skill', skill, at: 0 })
      events.push({
        kind: 'tool',
        tool: u.tool,
        input: u.input,
        ...(u.result !== undefined ? { result: u.result } : {}),
        ...(u.text !== undefined ? { text: u.text } : {}),
        ...(u.isError ? { isError: true } : {}),
        ...(u.agentId ? { agentId: u.agentId } : {}),
        at: 0,
      })
    }
  }
  return events
}

/**
 * The run as a resume leaves it: no agent still running. Background agents finish through task notifications the
 * transcript does not replay as turn ends, and none survives the session that launched it.
 */
export function stopAgents(s: RunState): RunState {
  const running = Object.entries(s.agents).filter(([, r]) => r.isRunning)
  if (running.length === 0) return s
  return { ...s, agents: { ...s.agents, ...Object.fromEntries(running.map(([id, r]) => [id, { ...r, isRunning: false }])) } }
}
