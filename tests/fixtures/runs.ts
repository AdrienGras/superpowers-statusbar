import type { ObservedEvent } from '../../types'

// Synthetic runs of a fictional recipe library, shaped like superpowers 7.0.0 sessions.

const REPO = '/repo'
export const PLAN = 'docs/superpowers/plans/2026-01-01-recettes.md'
export const SPEC = `${REPO}/docs/superpowers/specs/2026-01-01-recettes-design.md`
export const WORKSPACE = `${REPO}/.superpowers/sdd/2026-01-01-recettes`
const SP = '/home/dev/.claude/plugins/cache/superpowers-marketplace/superpowers/7.0.0/skills'
const SDD_SCRIPTS = `${SP}/subagent-driven-development/scripts`
const EXEC_SCRIPTS = `${SP}/executing-plans/scripts`

export const PLAN_TEXT = `# Recettes Implementation Plan

**Goal:** une bibliothèque de recettes de cuisine.

### Task 1: Modèle Recette

- [ ] **Step 1: Écrire le test qui échoue**
- [ ] **Step 2: Implémenter Recette**
- [ ] **Step 3: Commit**

### Task 2: Repository de recettes

- [ ] **Step 1: Écrire le test qui échoue**
- [ ] **Step 2: Implémenter le repository**
`

const LEDGER_HEADER = `# SDD ledger — plan: ${PLAN}
`

export const SDD_RUN_LEDGER = `${LEDGER_HEADER}
Ruling: pas de worktree — conteneur monté sur le dossier — coût : branche dans le dossier principal
Task 1: complete (commits a1b2c3d..e4f5a6b, review clean)
Task 2: fix round 1/5 (1 addressed, 0 open; commits e4f5a6b..0a1b2c3)
Task 2: minor (deferred): docblock incomplet
Task 2: complete (commits e4f5a6b..0a1b2c3, review clean)
`

/**
 * The plan, and the ledger as successive reads see it: header only when `sdd-workspace` runs
 * on a fresh plan, then the final ledger once the run writes it.
 */
export const FILES: Record<string, string | readonly string[]> = {
  [PLAN]: PLAN_TEXT,
  [`${WORKSPACE}/progress.md`]: [LEDGER_HEADER, SDD_RUN_LEDGER],
}

/** Builds events with increasing timestamps, one minute apart. */
function timeline(build: (at: () => number) => ObservedEvent[]): ObservedEvent[] {
  let t = 1_000_000
  return build(() => (t += 60_000))
}

type At = () => number

const skill = (at: At, name: string): ObservedEvent => ({ kind: 'skill', skill: `superpowers:${name}`, at: at() })
const report = (at: At, phase: string, agentId?: string): ObservedEvent =>
  ({ kind: 'tool', tool: 'mcp__superpowers-statusbar__report_phase', input: { phase }, ...(agentId ? { agentId } : {}), at: at() })
const write = (at: At, path: string, content: string): ObservedEvent =>
  ({ kind: 'tool', tool: 'Write', input: { file_path: path, content }, at: at() })
const bash = (at: At, command: string, stdout: string): ObservedEvent =>
  ({ kind: 'tool', tool: 'Bash', input: { command }, result: { stdout, stderr: '', interrupted: false }, text: stdout, at: at() })
const turnEnd = (at: At, answer: string, agentId?: string): ObservedEvent =>
  ({ kind: 'turn-end', answer, ...(agentId ? { agentId } : {}), at: at() })
const turnStart = (at: At): ObservedEvent => ({ kind: 'turn-start', at: at() })

function dispatch(at: At, agentId: string, description: string, prompt: string, answer?: string): ObservedEvent {
  const result = answer === undefined
    ? { status: 'async_launched', agentId, description, prompt }
    : { status: 'completed', agentId, content: [{ type: 'text', text: answer }], totalDurationMs: 1000 }
  return { kind: 'tool', tool: 'Agent', input: { description, prompt, subagent_type: 'general-purpose' }, result, at: at() }
}

const implementer = (at: At, id: string, n: string, title: string) =>
  dispatch(at, id, `Implement Task ${n}: ${title}`, `You are implementing Task ${n}: ${title}\n\n## Task Description\n`)
const reviewer = (at: At, id: string, n: string, verdict: 'Approved' | 'Needs fixes') =>
  dispatch(at, id, `Review Task ${n} (spec + quality)`, "You are reviewing one task's implementation: first whether it matches",
    `### Assessment\n\n**Task quality:** ${verdict}\n`)

function designAndPlan(at: At): ObservedEvent[] {
  return [
    skill(at, 'brainstorming'),
    report(at, 'conversation'),
    report(at, 'design-writing'),
    write(at, SPEC, '# Recettes — design\n\nUne bibliothèque de recettes.\n'),
    report(at, 'awaiting-approval'),
    turnEnd(at, 'Spec écrite, peux-tu la relire ?'),
    turnStart(at),
    skill(at, 'writing-plans'),
    report(at, 'drafting'),
    write(at, `${REPO}/${PLAN}`, PLAN_TEXT),
    report(at, 'self-review'),
  ]
}

function finish(at: At): ObservedEvent[] {
  return [
    dispatch(at, 'final', 'Review code changes', 'You are a Senior Code Reviewer with expertise in software architecture',
      '### Assessment\n\n**Ready to merge?** Yes\n'),
    bash(at, `rm -rf ${WORKSPACE}`, ''),
    skill(at, 'finishing-a-development-branch'),
    turnEnd(at, 'Implémentation terminée. Que veux-tu faire ?'),
    turnStart(at),
    bash(at, 'git checkout main && git merge feat/recettes', 'Fast-forward'),
  ]
}

export const SDD_RUN: ObservedEvent[] = timeline(at => [
  ...designAndPlan(at),
  skill(at, 'subagent-driven-development'),
  bash(at, `bash ${SDD_SCRIPTS}/sdd-workspace ${PLAN}`, `${WORKSPACE}\n`),

  bash(at, `bash ${SDD_SCRIPTS}/task-brief ${PLAN} 1`, `wrote ${WORKSPACE}/task-1-brief.md: 6 lines\n`),
  implementer(at, 'impl-1', '1', 'Modèle Recette'),
  turnEnd(at, 'Implémenteur de la tâche 1 lancé.'),
  turnEnd(at, '- **Status:** DONE\n- Commits: e4f5a6b feat: recette', 'impl-1'),
  turnStart(at),
  reviewer(at, 'rev-1', '1', 'Approved'),

  bash(at, `bash ${SDD_SCRIPTS}/task-brief ${PLAN} 2`, `wrote ${WORKSPACE}/task-2-brief.md: 5 lines\n`),
  implementer(at, 'impl-2', '2', 'Repository de recettes'),
  turnEnd(at, 'Implémenteur de la tâche 2 lancé.'),
  turnEnd(at, '- **Status:** DONE\n- Commits: 9f8e7d6 feat: repository', 'impl-2'),
  turnStart(at),
  reviewer(at, 'rev-2', '2', 'Needs fixes'),
  { kind: 'tool', tool: 'SendMessage', input: { to: 'impl-2', message: 'Fix: le test de borne manque.' }, at: at() },
  turnEnd(at, 'Correction demandée.'),
  turnEnd(at, '- **Status:** DONE\n- Commits: 0a1b2c3 fix: borne', 'impl-2'),
  turnStart(at),
  dispatch(at, 'rerev-2', 'Re-review Task 2 fix round 1', "You are re-reviewing one task's fix round. A previous review",
    '### Verdict\n\n**Fix round:** All findings addressed, no new Critical/Important breakage\n'),
  write(at, `${WORKSPACE}/progress.md`, SDD_RUN_LEDGER),

  ...finish(at),
])

function directTask(at: At, n: string): ObservedEvent[] {
  return [
    bash(at, `${EXEC_SCRIPTS}/task-start ${PLAN} ${n}`, `brief: ${WORKSPACE}/task-${n}-brief.md\nbase: 0123456789abcdef\n`),
    report(at, 'red'),
    report(at, 'green'),
    report(at, 'refactor'),
    bash(at, `${EXEC_SCRIPTS}/task-done ${PLAN} ${n} 0123456789abcdef -- npm test`,
      `12 passing\nledger: Task ${n}: complete (commits 0123456..89abcde, tests: npm test → 12 passing)\n`),
  ]
}

export const DIRECT_RUN: ObservedEvent[] = timeline(at => [
  ...designAndPlan(at),
  skill(at, 'executing-plans'),
  bash(at, `${SP}/subagent-driven-development/scripts/sdd-workspace ${PLAN}`, `${WORKSPACE}\n`),
  ...directTask(at, '1'),
  ...directTask(at, '2'),
  ...finish(at),
])
