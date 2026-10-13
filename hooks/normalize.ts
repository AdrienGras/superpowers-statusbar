import type { ToolCallInput, ToolCallResult } from 'claude-code'

import type { ObservedEvent } from '../types'

/** Keys `tool.call` carries beside the tool's own arguments. */
const ENVELOPE: ReadonlySet<string> = new Set(['tool', 'tool_use_id', 'agentId', 'requestMeta', 'consent'])

/** A finished tool call as the detectors read it: the tool's arguments as `input`, then how it ended. */
export function toolEvent(e: ToolCallInput, ran: ToolCallResult, at: number): Extract<ObservedEvent, { kind: 'tool' }> {
  const input = Object.fromEntries(Object.entries(e).filter(([k]) => !ENVELOPE.has(k)))
  const outcome = ran.deny !== undefined
    ? { text: ran.deny, isError: true }
    : {
        ...(ran.result !== undefined ? { result: ran.result } : {}),
        ...(ran.text !== undefined ? { text: ran.text } : {}),
        ...(ran.isError ? { isError: true } : {}),
      }
  return { kind: 'tool', tool: e.tool, input, ...outcome, ...(e.agentId ? { agentId: e.agentId } : {}), at }
}

/** A skill's bare name: `superpowers:brainstorming` and `brainstorming` both give `brainstorming`. */
export function skillName(skill: string): string {
  return skill.startsWith('superpowers:') ? skill.slice('superpowers:'.length) : skill
}
