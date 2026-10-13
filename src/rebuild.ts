import type { ObservedEvent } from '../types'

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
