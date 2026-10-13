import type { ReportedPhase } from '../types'

type InstrumentedSkill = 'brainstorming' | 'writing-plans' | 'test-driven-development'

/** The phases each instrumented skill reports, in the order the skill goes through them. */
export const PHASES_BY_SKILL: Record<InstrumentedSkill, readonly ReportedPhase[]> = {
  'brainstorming': ['conversation', 'design-writing', 'builder-check', 'awaiting-approval'],
  'writing-plans': ['drafting', 'self-review'],
  'test-driven-development': ['red', 'green', 'refactor'],
}

/** When the model reports each phase, as the instrumentation section words it. */
const WHEN: Record<ReportedPhase, string> = {
  'conversation': 'you are asking questions or playing understanding back',
  'design-writing': 'you are writing the design document',
  'builder-check': 'the builder check subagent is reading the document',
  'awaiting-approval': 'the document is handed over for approval',
  'drafting': 'you are writing the plan',
  'self-review': 'you are running the self-review checklist',
  'red': 'you are writing a failing test and watching it fail',
  'green': 'you are writing the minimal code to make it pass',
  'refactor': 'you are cleaning up with the tests green',
}

const ALL_PHASES: readonly ReportedPhase[] = Object.values(PHASES_BY_SKILL).flat()

/** The tool the model calls to report a phase, listed to it as `mcp__superpowers-statusbar__report_phase`. */
export const REPORT_TOOL: { name: 'report_phase'; description: string; inputSchema: Record<string, unknown>; isDeferred: false } = {
  name: 'report_phase',
  description: 'Reports the current superpowers phase to the status bar. Call it only when a skill\'s "Progress reporting" section asks you to.',
  inputSchema: {
    type: 'object',
    properties: { phase: { type: 'string', enum: ALL_PHASES } },
    required: ['phase'],
  },
  isDeferred: false,
}

const INTRO = 'A status bar is tracking this run for your human partner. Each time you move into one of the phases below, '
  + 'call the tool `mcp__superpowers-statusbar__report_phase` once with that phase, then carry on. It is a signal only: '
  + 'it changes nothing about how you follow this skill, and you report nothing else.'

const isInstrumented = (skill: string): skill is InstrumentedSkill => Object.hasOwn(PHASES_BY_SKILL, skill)

/**
 * The skill's text with the progress-reporting section appended, for the three skills that report phases;
 * any other skill's text unchanged. `skill` is the bare name (`brainstorming`, not `superpowers:brainstorming`).
 */
export function instrumentSkill(skill: string, text: string): string {
  if (!isInstrumented(skill)) return text
  const phases = PHASES_BY_SKILL[skill].map(p => `- \`${p}\`: ${WHEN[p]}`).join('\n')
  const gap = text === '' ? '' : text.endsWith('\n\n') ? '' : text.endsWith('\n') ? '\n' : '\n\n'
  return `${text}${gap}## Progress reporting (superpowers-statusbar)\n\n${INTRO}\n\n${phases}\n`
}
