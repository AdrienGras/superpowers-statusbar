import type { ObservedEvent } from '../types'

/**
 * The skill starting that a finished `Skill` call shows, or nothing: a call that failed, or that names no skill,
 * starts none. The call's `agentId` (a subagent made it) travels with the event.
 */
export function skillOfCall(
  call: { tool: string; input: Record<string, unknown>; isError?: boolean; agentId?: string },
  at: number,
): Extract<ObservedEvent, { kind: 'skill' }> | undefined {
  const skill = call.tool === 'Skill' && !call.isError ? call.input.skill : undefined
  if (typeof skill !== 'string') return undefined
  return { kind: 'skill', skill, ...(call.agentId ? { agentId: call.agentId } : {}), at }
}
