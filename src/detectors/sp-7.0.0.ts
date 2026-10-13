import type {
  Action, AgentRoleName, Detection, FileRequest, Mode, ObservedEvent, ReportedPhase, RunState, Stage,
} from '../../types'
import { parsePlan } from '../plan.ts'
import { parseLedger } from '../ledger.ts'

/** A string superpowers 7.0.0 must still contain for a detection rule to hold. `file` is relative to the plugin root. */
export type Marker = { id: string; file: string; pattern: RegExp }

const literal = (text: string) => new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
const marker = (id: string, file: string, text: string): Marker => ({ id, file, pattern: literal(text) })

const SDD = 'skills/subagent-driven-development'
const EXEC = 'skills/executing-plans'

export const MARKERS: readonly Marker[] = [
  marker('skill.brainstorming', 'skills/brainstorming/SKILL.md', 'name: brainstorming'),
  marker('skill.writing-plans', 'skills/writing-plans/SKILL.md', 'name: writing-plans'),
  marker('skill.subagent-driven-development', `${SDD}/SKILL.md`, 'name: subagent-driven-development'),
  marker('skill.executing-plans', `${EXEC}/SKILL.md`, 'name: executing-plans'),
  marker('skill.finishing-a-development-branch', 'skills/finishing-a-development-branch/SKILL.md', 'name: finishing-a-development-branch'),
  marker('spec.path', 'skills/brainstorming/SKILL.md', 'docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md'),
  marker('plan.task-heading', 'skills/writing-plans/SKILL.md', '### Task N: [Component Name]'),
  marker('plan.step', 'skills/writing-plans/SKILL.md', '- [ ] **Step 1: Write the failing test**'),
  marker('script.sdd-workspace', `${SDD}/scripts/sdd-workspace`, 'Usage: sdd-workspace PLAN_FILE'),
  marker('workspace.path', `${SDD}/scripts/sdd-workspace`, `CDPATH='' cd -- "$dir" && pwd`),
  marker('workspace.base', `${SDD}/scripts/sdd-workspace`, 'base="$root/.superpowers/sdd"'),
  marker('workspace.ledger', `${SDD}/SKILL.md`, '`<workspace>/progress.md`'),
  marker('workspace.ledger.direct', `${EXEC}/SKILL.md`, '`<workspace>/progress.md`'),
  marker('workspace.remove', `${SDD}/SKILL.md`, '`rm -rf <workspace>`'),
  marker('script.task-brief', `${SDD}/scripts/task-brief`, 'Usage: task-brief PLAN_FILE TASK_NUMBER'),
  marker('script.task-brief.output', `${SDD}/scripts/task-brief`, 'echo "wrote ${out}: $(wc -l < "$out" | tr -d \' \') lines"'),
  marker('script.task-start', `${EXEC}/scripts/task-start`, 'Usage: task-start PLAN_FILE TASK_NUMBER'),
  marker('script.task-start.output', `${EXEC}/scripts/task-start`, 'echo "brief: $brief"'),
  marker('script.task-done', `${EXEC}/scripts/task-done`, 'Usage: task-done PLAN_FILE TASK_NUMBER BASE -- TEST_COMMAND'),
  marker('script.task-done.ledger', `${EXEC}/scripts/task-done`, 'echo "ledger: $line"'),
  marker('dispatch.implementer', `${SDD}/implementer-prompt.md`, 'description: "Implement Task N: [task name]"'),
  marker('dispatch.implementer.prompt', `${SDD}/implementer-prompt.md`, 'You are implementing Task N: [task name]'),
  marker('dispatch.reviewer', `${SDD}/task-reviewer-prompt.md`, 'description: "Review Task N (spec + quality)"'),
  marker('dispatch.reviewer.prompt', `${SDD}/task-reviewer-prompt.md`, "You are reviewing one task's implementation"),
  marker('dispatch.re-reviewer', `${SDD}/re-review-prompt.md`, 'description: "Re-review Task N fix round R"'),
  marker('dispatch.re-reviewer.prompt', `${SDD}/re-review-prompt.md`, "You are re-reviewing one task's fix round"),
  marker('dispatch.final-reviewer', 'skills/requesting-code-review/code-reviewer.md', 'description: "Review code changes"'),
  marker('dispatch.final-reviewer.prompt', 'skills/requesting-code-review/code-reviewer.md', 'You are a Senior Code Reviewer'),
  marker('dispatch.builder-check', 'skills/brainstorming/builder-check-prompt.md', 'You are a talented'),
  marker('dispatch.builder-check.document', 'skills/brainstorming/builder-check-prompt.md', "You've been handed a design document"),
  marker('report.status', `${SDD}/implementer-prompt.md`, '- **Status:** DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT'),
  marker('report.task-quality', `${SDD}/task-reviewer-prompt.md`, '**Task quality:** [Approved | Needs fixes]'),
  marker('report.fix-round', `${SDD}/re-review-prompt.md`, '**Fix round:** [All findings addressed'),
  marker('report.fix-round.open', `${SDD}/re-review-prompt.md`, '| Findings remain open]'),
  marker('report.ready-to-merge', 'skills/requesting-code-review/code-reviewer.md', '**Ready to merge?** [Yes | No | With fixes]'),
  marker('ledger.complete', `${SDD}/SKILL.md`, '`Task <N>: complete (commits <base7>..<head7>, review clean)`'),
  marker('ledger.complete.direct', `${EXEC}/scripts/task-done`, 'line="Task $n: complete (commits'),
  marker('ledger.fix-round', `${SDD}/SKILL.md`, '`Task <N>: fix round <R>/5'),
  marker('ledger.minor', `${SDD}/SKILL.md`, '`Task <N>: minor (deferred): <one-liner>`'),
  marker('ledger.minor.final', `${EXEC}/SKILL.md`, '`Final: minor (deferred): <one-liner>`'),
  marker('ledger.parked', `${SDD}/SKILL.md`, '`Task <N>: parked — <finding> — Ruling: <why the code stands>`'),
  marker('ledger.ruling', `${SDD}/SKILL.md`, '`Ruling: <what you decided> — <why> — <what it costs if wrong>`'),
  marker('ledger.task-ruling', `${SDD}/SKILL.md`, '`Task <N>: Ruling: <finding> — <what you decided and why>`'),
  marker('finishing.merge', 'skills/finishing-a-development-branch/SKILL.md', 'git merge <feature-branch>'),
  marker('finishing.push', 'skills/finishing-a-development-branch/SKILL.md', 'git push -u origin <feature-branch>'),
]

// --- detection ---

const SKILL_STAGES: Readonly<Record<string, { stage: Stage; mode?: Mode }>> = {
  'brainstorming': { stage: 'brainstorm' },
  'writing-plans': { stage: 'plan' },
  'subagent-driven-development': { stage: 'exec', mode: 'sdd' },
  'executing-plans': { stage: 'exec', mode: 'direct' },
  'finishing-a-development-branch': { stage: 'finishing' },
}

const REPORTED_PHASES: ReadonlySet<string> = new Set<ReportedPhase>([
  'conversation', 'design-writing', 'builder-check', 'awaiting-approval',
  'drafting', 'self-review', 'red', 'green', 'refactor',
])

const REPORT_TOOL = 'mcp__superpowers-statusbar__report_phase'

const RM_WORKSPACE = /\brm\s+-[a-zA-Z]*[rR][a-zA-Z]*\s+(?:--\s+)?["']?[^\s"';&|]*\.superpowers\/sdd\/[^\s"'/;&|]+\/?["']?(?=$|[\s;&|])/
const FINISH = /(?:^|[\s;&|(])(?:git\s+(?:-C\s+\S+\s+)?(?:merge|push)|gh\s+pr\s+create)(?=$|[\s;&|)])/

const none = (): Detection => ({ actions: [], reads: [] })
const only = (a: Action): Detection => ({ actions: [a], reads: [] })
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)
const isBeforeExec = (s: RunState) => s.stage === 'brainstorm' || s.stage === 'plan'

export function detect(e: ObservedEvent, s: RunState | null): Detection {
  switch (e.kind) {
    case 'skill': return skillUsed(e.skill, e.at)
    case 'turn-start': return s ? only({ type: 'turn-started', at: e.at }) : none()
    case 'turn-end':
      if (!s) return none()
      return only(e.agentId
        ? { type: 'agent-reported', agentId: e.agentId, answer: e.answer, at: e.at }
        : { type: 'turn-ended', at: e.at })
    case 'file':
      if (!s) return none()
      return only(e.role === 'plan'
        ? { type: 'plan-loaded', path: e.path, tasks: parsePlan(e.text), at: e.at }
        : { type: 'ledger-loaded', lines: parseLedger(e.text), at: e.at })
    case 'tool': return toolUsed(e, s)
  }
}

function skillUsed(skill: string, at: number): Detection {
  const name = skill.startsWith('superpowers:') ? skill.slice('superpowers:'.length) : skill
  const entry = Object.hasOwn(SKILL_STAGES, name) ? SKILL_STAGES[name] : undefined
  if (!entry) return none()
  return only({ type: 'stage-entered', stage: entry.stage, ...(entry.mode ? { mode: entry.mode } : {}), at })
}

type ToolEvent = Extract<ObservedEvent, { kind: 'tool' }>

function toolUsed(e: ToolEvent, s: RunState | null): Detection {
  const d = e.tool === 'Bash' ? bashRan(e, s) : none()
  if (!s) return d
  switch (e.tool) {
    case REPORT_TOOL: {
      const phase = str(e.input.phase)
      if (!phase || !REPORTED_PHASES.has(phase)) return d
      d.actions.push({ type: 'phase-reported', phase: phase as ReportedPhase, ...(e.agentId ? { agentId: e.agentId } : {}), at: e.at })
      break
    }
    case 'Write': fileWritten(e, s, d); break
    case 'Agent': agentDispatched(e, s, d); break
    case 'SendMessage': {
      const to = str(e.input.to)
      if (to && s.agents[to]) d.actions.push({ type: 'agent-resumed', agentId: to, at: e.at })
      break
    }
  }
  if ((e.tool === 'Write' || e.tool === 'Edit' || e.tool === 'Bash') && s.workspace && mentionsLedger(e.input)) {
    addRead(d, { role: 'ledger', path: `${s.workspace}/progress.md` })
  }
  return d
}

function addRead(d: Detection, r: FileRequest) {
  if (!d.reads.some(x => x.role === r.role && x.path === r.path)) d.reads.push(r)
}

const mentionsLedger = (input: Record<string, unknown>) =>
  Object.values(input).some(v => typeof v === 'string' && v.includes('progress.md'))

function fileWritten(e: ToolEvent, s: RunState, d: Detection) {
  const path = str(e.input.file_path)
  if (!path?.endsWith('.md')) return
  if (s.stage === 'brainstorm' && (path.includes('/specs/') || path.endsWith('-design.md'))) {
    d.actions.push({ type: 'spec-written', path, at: e.at })
    return
  }
  if (!isBeforeExec(s)) return
  const tasks = parsePlan(str(e.input.content) ?? '')
  if (tasks.length > 0) d.actions.push({ type: 'plan-loaded', path, tasks, at: e.at })
}

// --- Bash ---

/** Text the tool printed: `result.stdout` when the result carries one, else the rendered text. */
function outputOf(e: ToolEvent): string {
  const r = e.result
  if (r && typeof r === 'object' && 'stdout' in r && typeof r.stdout === 'string') return r.stdout
  return e.text ?? ''
}

const unquote = (arg: string) => arg.replace(/^(["'])(.*)\1$/, '$2')

/** Arguments following the script `name` (matched by basename anywhere in the command), or undefined if absent. */
function scriptArgs(command: string, name: string): string[] | undefined {
  const m = new RegExp(`(?:^|[\\s/"'(;&|=])${name}["']?(?=$|[\\s;&|)])((?:[ \\t]+[^\\s;&|)]+)*)`).exec(command)
  if (!m) return undefined
  return m[1]!.trim().split(/\s+/).filter(Boolean).map(unquote)
}

/** The output line naming a plan workspace (`…/.superpowers/sdd/<name>`), whatever else the command printed. */
function workspaceLine(text: string): string | undefined {
  return text.split(/\r?\n/).map(l => l.trim()).find(l => /(?:^|\/)\.superpowers\/sdd\/[^/\s]+\/*$/.test(l))
}

function bashRan(e: ToolEvent, s: RunState | null): Detection {
  const d = none()
  const command = str(e.input.command) ?? ''
  const out = outputOf(e)
  const isOk = !e.isError

  const ws = scriptArgs(command, 'sdd-workspace')
  const plan = ws?.[0]
  if (plan && isOk) {
    const workspace = workspaceLine(out)?.replace(/\/+$/, '')
    if (!s || isBeforeExec(s)) d.actions.push({ type: 'stage-entered', stage: 'exec', at: e.at })
    if (workspace) d.actions.push({ type: 'workspace-found', path: workspace, planPath: plan, at: e.at })
    d.reads.push({ role: 'plan', path: plan })
    if (workspace) d.reads.push({ role: 'ledger', path: `${workspace}/progress.md` })
  }
  if (!s) return d

  const brief = scriptArgs(command, 'task-brief')?.[1]
  if (brief && isOk && /^wrote .+: [0-9]+ lines$/m.test(out)) d.actions.push({ type: 'task-started', task: brief, at: e.at })

  const start = scriptArgs(command, 'task-start')?.[1]
  if (start && isOk && /^brief: /m.test(out)) d.actions.push({ type: 'task-started', task: start, at: e.at })

  const done = scriptArgs(command, 'task-done')
  if (done && done.length >= 4 && done[3] === '--') {
    d.actions.push({ type: 'task-verified', task: done[1]!, isOk: isOk && out.includes('ledger: Task'), at: e.at })
  }

  if (isOk && RM_WORKSPACE.test(command)) d.actions.push({ type: 'workspace-removed', at: e.at })
  if (isOk && s.stage === 'finishing' && FINISH.test(command)) d.actions.push({ type: 'branch-finished', at: e.at })
  return d
}

// --- Agent ---

type Role = { role: AgentRoleName; task?: string; round?: number }

function roleOf(input: Record<string, unknown>, s: RunState): Role {
  const description = str(input.description) ?? ''
  const prompt = (str(input.prompt) ?? '').trimStart()
  const isFinalReviewTime = s.stage === 'exec' || s.stage === 'final-review'
  let m = /^Implement Task (\S+?):?\s/.exec(description)
  if (m) return { role: 'implementer', task: m[1]! }
  m = /^Review Task (\S+) \(spec \+ quality\)/.exec(description)
  if (m) return { role: 'reviewer', task: m[1]! }
  m = /^Re-review Task (\S+) fix round (\d+)/.exec(description)
  if (m) return { role: 're-reviewer', task: m[1]!, round: Number(m[2]) }
  if (isFinalReviewTime && /^Review code changes/.test(description)) return { role: 'final-reviewer' }
  if (prompt.startsWith('You are a talented') && prompt.includes('design document')) return { role: 'builder-check' }

  const first = prompt.split('\n', 1)[0] ?? ''
  m = /^You are implementing Task (\S+?):/.exec(first)
  if (m) return { role: 'implementer', task: m[1]! }
  if (first.startsWith("You are reviewing one task's implementation")) return { role: 'reviewer' }
  if (first.startsWith("You are re-reviewing one task's fix round")) return { role: 're-reviewer' }
  if (isFinalReviewTime && first.startsWith('You are a Senior Code Reviewer')) return { role: 'final-reviewer' }
  // Real runs also word the final review their own way, in English or French: any review once every task is
  // done, except the dispatch that fixes its findings.
  const isAfterTasks = s.stage === 'final-review' || (s.stage === 'exec' && s.tasks.length > 0 && s.tasks.every(t => t.status === 'done'))
  if (isAfterTasks && /review|revue/i.test(description) && !/\bfix|correct/i.test(description)) return { role: 'final-reviewer' }
  return { role: 'other' }
}

function agentDispatched(e: ToolEvent, s: RunState, d: Detection) {
  const r = e.result
  if (!r || typeof r !== 'object' || !('agentId' in r) || typeof r.agentId !== 'string') return
  const agentId = r.agentId
  const status = 'status' in r ? r.status : undefined
  d.actions.push({ type: 'agent-dispatched', agentId, ...roleOf(e.input, s), isRunning: status === 'async_launched', at: e.at })
  if (status === 'completed') d.actions.push({ type: 'agent-reported', agentId, answer: textOf('content' in r ? r.content : undefined), at: e.at })
}

function textOf(content: unknown): string {
  if (!Array.isArray(content)) return ''
  return content
    .filter((c): c is { type: 'text'; text: string } =>
      !!c && typeof c === 'object' && c.type === 'text' && typeof c.text === 'string')
    .map(c => c.text)
    .join('\n')
}
