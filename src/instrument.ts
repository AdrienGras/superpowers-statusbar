import type { ReportedPhase } from '../types'

type ReportingSkill = 'brainstorming' | 'writing-plans' | 'test-driven-development'

/** The phases each skill reports, in the order the skill goes through them. */
const PHASES_BY_SKILL: Record<ReportingSkill, readonly ReportedPhase[]> = {
  'brainstorming': ['conversation', 'design-writing', 'builder-check', 'awaiting-approval'],
  'writing-plans': ['drafting', 'self-review'],
  'test-driven-development': ['red', 'green', 'refactor'],
}

/** When the model reports each phase, as the tool description words it. */
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

/** Every phase the tool accepts; the detector accepts the same set. */
export const ALL_PHASES: readonly ReportedPhase[] = Object.values(PHASES_BY_SKILL).flat()

const phaseLines = (skill: ReportingSkill) => PHASES_BY_SKILL[skill].map(p => `- \`${p}\`: ${WHEN[p]}`).join('\n')

/**
 * The reporting instructions, which the model reads in the tool list on every request and in every subagent:
 * Claude Code's built-in security plugin skips plugins' `skill.prompt` hooks, so the skills' text cannot carry them.
 */
const DESCRIPTION = [
  'Reports the current superpowers phase to the status bar your human partner watches. Call it only while following '
    + 'superpowers\' brainstorming, writing-plans or test-driven-development skill: once each time you move into one of '
    + 'the phases below, then carry on. It is a signal only: it changes nothing about how you follow the skill, and you '
    + 'report nothing else. This includes executing a plan yourself (superpowers\' executing-plans): report red, green '
    + 'and refactor for each task as you go, as an implementer subagent does.',
  ...(Object.keys(PHASES_BY_SKILL) as ReportingSkill[]).map(skill => `${skill}:\n${phaseLines(skill)}`),
].join('\n\n')

/** The tool the model calls to report a phase, listed to it as `mcp__superpowers-statusbar__report_phase`. */
export const REPORT_TOOL: { name: 'report_phase'; description: string; inputSchema: Record<string, unknown>; isDeferred: false } = {
  name: 'report_phase',
  description: DESCRIPTION,
  inputSchema: {
    type: 'object',
    properties: { phase: { type: 'string', enum: ALL_PHASES } },
    required: ['phase'],
  },
  isDeferred: false,
}
