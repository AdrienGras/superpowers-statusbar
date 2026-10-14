# Reliable RED / GREEN phases (#3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every task executed under TDD with Sonnet shows `red` then `green`, inline and in SDD, without ever showing a false phase: the model is told to report at session and subagent start (track B), and the mod infers the phases it did not report from writes and runs of the plan's declared commands (track A).

**Architecture:** Track B is a classic `SessionStart` / `SubagentStart` hook in `hooks/hooks.json` serving a pre-generated JSON whose text comes from `src/instrument.ts`. Track A is pure: `parsePlan` lists each task's run commands, `src/tdd.ts` matches commands and finds writes, the detector emits a `work-observed` action for the routed task, and the reducer turns it into `red` / `green` events with an `origin`, under one segment rule shared with reported phases. The e2e harness gets a bats fixture and requires red then green per done task.

**Tech Stack:** TypeScript (erasable only), Claude Code mod API `claude-code` (Claude Code 2.1.296), tests with `claude-code/testing`, Node 24 for `scripts/`, bash + bats for the e2e fixture.

**Spec:** `docs/superpowers/specs/2026-10-14-tdd-phases-design.md`, on top of the reference design `docs/superpowers/specs/2026-10-13-superpowers-statusbar-design.md`. Spike material (throwaway, read-only): worktree `/srv/AdrienGras/superpowers-statusbar-spike3`, branch `spike/3-tdd-phases` (`spike/fixture-bats/`, `spike/replay.ts`, `spike/run.sh`).

## Global Constraints

- Read `.claude/CLAUDE.md` first: engine constraints (no `$` across files, `EnginePort`, one atom per rendering file, `tool.call` answers `{ result }`), `src/` pure (no `$`, no Node API), erasable TS only (no `enum`, no `namespace`), relative imports with `.ts`, `import type` for types, `hooks/` may import `src/`, never the reverse.
- Engine API declarations: `.claude-plugin/types/claude-code/index.d.ts` (grep it).
- Displayed text (band, pane, notifications, README, dev scripts' output) is English.
- Anti-goals: never show false information with confidence (when in doubt, nothing); never change superpowers' behaviour or text — a static instruction at session/subagent start is allowed (Adrien, 14/10), a reminder injected mid-flow (e.g. after a test run) is not; a fresh session adopts nothing from disk.
- Track A never claims tests pass or fail; it never infers `refactor`.
- Heuristics stay bilingual (EN/FR): plan step titles and run lines.
- The hook script must not need `jq` nor a Node able to run TypeScript on the user's machine.
- No client data in git: fixtures stay synthetic.
- Commits in English, `type: subject`, each ending with:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_012rzJnDxSAHhEKWnTCSndQj
  ```
- Each task ends green on: `claude plugin test .` and `npm run typecheck`.

## Review Focus

- A write and a run in one Bash call (`cat >> test/x.bats <<'EOF' … EOF && bats test/x.bats`): counts as write then run, so `red` then `green` (Task 4).
- A test run that fails without a pipe comes back `isError` with `Exit code 1…`: it ran and must count; a refused call (`deny`, "Permission to use Bash has been denied", "Contains brace with quote character") must not (Task 4).
- A reviewer, final reviewer or the controller in SDD runs the tests: never a phase for the task (Task 4).
- A fix round (new implementer, or the original resumed with `SendMessage`) starts a new segment: red then green again, never a stale write from the previous segment turning into `green` (Task 3).
- A model that reports two cycles in one task (`red, green, red, green`): one `red`, one `green` in the segment, never `red` after `green` (Task 3).

---

### Task 1: Plan run commands and contract markers

**Files:**
- Modify: `types/index.d.ts` (`PlanTask`)
- Modify: `src/plan.ts`
- Modify: `src/detectors/sp-7.0.0.ts` (`MARKERS`)
- Test: `tests/plan.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `PlanTask = { n: string; title: string; steps: number; runs?: string[] }` — `runs` present only when the task declares at least one run command, in plan order, de-duplicated. `parsePlan(text: string): PlanTask[]` fills it.

Rules (fence-aware, as `parsePlan` already is):
- A **run line** outside fences: `/^\s*(?:\*\*)?(Run|Lancer|Commande|Exécuter)(?:\*\*)?\s*:\s*(?:\*\*)?\s*`([^`]+)`/i` → the backticked command.
- A **fenced block** opened inside a step whose title (`- [ ] **Step N: <title>**`, `[ xX]`) matches `/\b(run|verify|confirm|lancer|lance|exécuter|vérifier)\b/i` → each non-empty line of the block that does not start with `#` is a command.
- A command whose program is `git` is dropped.

- [ ] **Step 1: Write the failing tests** in `tests/plan.test.ts`:

```ts
test('parsePlan lists the run commands of the template steps', () => {
  const text = [
    '### Task 1: slugify',
    '- [ ] **Step 1: Write the failing test**',
    '- [ ] **Step 2: Run test to verify it fails**',
    'Run: `bats test/text.bats --filter slugify`',
    'Expected: FAIL, `slugify: command not found`.',
    '- [ ] **Step 4: Run test to verify it passes**',
    'Run: `bats test/text.bats`',
    'Expected: PASS',
    '- [ ] **Step 5: Commit**',
    '```bash',
    'git commit -m "feat: slugify"',
    '```',
  ].join('\n')
  expect(parsePlan(text)).toEqual([{ n: '1', title: 'slugify', steps: 4, runs: ['bats test/text.bats --filter slugify', 'bats test/text.bats'] }])
})

test('parsePlan reads French run lines and fenced commands under a run step', () => {
  const text = [
    '### Task 2: Recettes',
    '- [ ] **Step 2: Lancer le test, vérifier l\'échec**',
    '```bash',
    '# depuis la racine',
    'uv run pytest tests/test_recettes.py::test_liste -v',
    '```',
    '- [ ] **Step 4: Lancer les tests**',
    '**Lancer :** `uv run pytest`',
  ].join('\n')
  expect(parsePlan(text)[0]!.runs).toEqual(['uv run pytest tests/test_recettes.py::test_liste -v', 'uv run pytest'])
})

test('parsePlan gives no runs to a task without run steps, and ignores code under other steps', () => {
  const text = ['### Task 1: Doc', '- [ ] **Step 1: Write the README**', '```bash', 'npm test', '```'].join('\n')
  expect(parsePlan(text)).toEqual([{ n: '1', title: 'Doc', steps: 1 }])
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `claude plugin test .`
Expected: FAIL on the three new tests (`runs` missing).

- [ ] **Step 3: Implement the rules above in `src/plan.ts`; add `runs?: string[]` to `PlanTask`**

- [ ] **Step 4: Add contract markers** to `MARKERS` in `src/detectors/sp-7.0.0.ts`, beside `plan.step`:
  - `marker('plan.run-line', 'skills/writing-plans/SKILL.md', 'Run: \`')`
  - `marker('plan.expected-fail', 'skills/writing-plans/SKILL.md', 'Expected: FAIL')`
  - `marker('plan.verify-fails', 'skills/writing-plans/SKILL.md', '**Step 2: Run test to verify it fails**')`
  - `marker('exec.expected-line', \`${EXEC}/SKILL.md\`, 'Every step that runs a command has an \`Expected:\` line.')`

- [ ] **Step 5: Run tests and contract**

Run: `claude plugin test . && npm run typecheck && npm run contract -- ~/.claude/plugins/cache/superpowers-marketplace/superpowers/7.0.0`
Expected: all pass; contract prints 52 markers OK (48 + 4).

- [ ] **Step 6: Commit**

```bash
git add types/index.d.ts src/plan.ts src/detectors/sp-7.0.0.ts tests/plan.test.ts
git commit -m "feat: plan tasks list their run commands"
```

### Task 2: Command matching and write detection (`src/tdd.ts`)

**Files:**
- Create: `src/tdd.ts`
- Test: `tests/tdd.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `matchesPlanRun(command: string, runs: readonly string[]): boolean`
  - `redirectTargets(command: string): string[]` — files a Bash command writes through `>`, `>>` or `tee [-a]`.
  - `isWorkPath(path: string): boolean` — false under `.superpowers/`, `docs/superpowers/`, `/dev/`, `.claude/`, and for `&N`.
  - `isSuperpowersScript(command: string): boolean` — the command calls `task-start` or `task-done`.

Matching (stricter than the spec's wording, on purpose — "miss rather than be wrong"; the spec's examples all still hold): split the executed command into segments on `&&`, `||`, `;`, `|`, newline; drop leading `VAR=value` words; skip `cd` segments. A plan command's **key** is its positional words (not starting with `-`), taken up to and including the first path-like word (containing `/`, `.` or `:`), at most 3. Both sides drop a `::selector` suffix. A segment matches when its program's basename equals the key's first word's basename and the remaining key words appear in the segment in order, a path-like key word matching a segment word equal to it or ending with `/` + it.

- [ ] **Step 1: Write the failing tests** in `tests/tdd.test.ts`:

```ts
test('matchesPlanRun accepts the forms seen in real runs', () => {
  expect(matchesPlanRun('cd /r; npm test 2>&1 | tail -10', ['npm test'])).toBe(true)
  expect(matchesPlanRun('npm --prefix /tmp/x/repo test', ['npm test'])).toBe(true)
  expect(matchesPlanRun('bats test/text.bats', ['bats test/text.bats --filter slugify'])).toBe(true)
  expect(matchesPlanRun('bats /tmp/r/test/text.bats -f slugify', ['bats test/text.bats'])).toBe(true)
  expect(matchesPlanRun('uv run pytest tests/a.py -v', ['uv run pytest tests/a.py::test_x -v'])).toBe(true)
  expect(matchesPlanRun("cat >> test/t.bats <<'EOF'\n@test x {}\nEOF\nbats test/t.bats", ['bats test/t.bats'])).toBe(true)
})

test('matchesPlanRun refuses other commands', () => {
  expect(matchesPlanRun('uv run python x.py', ['uv run pytest tests/a.py'])).toBe(false)
  expect(matchesPlanRun('cat package.json', ['npm test'])).toBe(false)
  expect(matchesPlanRun('npm install', ['npm test'])).toBe(false)
  expect(matchesPlanRun('bats test/other.bats', ['bats test/text.bats'])).toBe(false)
  expect(matchesPlanRun('npm test', [])).toBe(false)
})

test('redirectTargets lists written files, not fd duplications', () => {
  expect(redirectTargets("cat >> test/text.bats <<'EOF'\nx\nEOF")).toEqual(['test/text.bats'])
  expect(redirectTargets('npm test 2>&1 | tee out.log')).toEqual(['out.log'])
  expect(redirectTargets('npm test 2>&1 | head')).toEqual([])
})

test('isWorkPath excludes the workspace, the spec and plan folders, /dev and .claude', () => {
  expect(isWorkPath('/r/src/text.sh')).toBe(true)
  expect(isWorkPath('/r/.superpowers/sdd/p/progress.md')).toBe(false)
  expect(isWorkPath('docs/superpowers/plans/p.md')).toBe(false)
  expect(isWorkPath('/dev/null')).toBe(false)
})

test('isSuperpowersScript spots task-start and task-done', () => {
  expect(isSuperpowersScript('git commit -q -m x && /sp/skills/executing-plans/scripts/task-done plan.md 2 abc -- npm test')).toBe(true)
  expect(isSuperpowersScript('npm test')).toBe(false)
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `claude plugin test .`
Expected: FAIL, `src/tdd.ts` does not exist.

- [ ] **Step 3: Implement `src/tdd.ts`** (the redirect pattern from the spike: `/(?:^|[^0-9&])(?:>>?|tee(?: -a)?)\s*['"]?([^\s'";|&<>]+)/g`, dropping targets starting with `&`).

- [ ] **Step 4: Run tests to verify they pass**

Run: `claude plugin test . && npm run typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/tdd.ts tests/tdd.test.ts
git commit -m "feat: match plan run commands and file writes"
```

### Task 3: Reducer — phase origin, segments, observed work

**Files:**
- Modify: `types/index.d.ts` (`TaskEvent`, `TaskState`, `Action`)
- Modify: `src/reduce.ts`
- Test: `tests/reduce.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `TaskEvent` gains `origin?: 'reported' | 'observed'` (set on `red` / `green` / `refactor` only).
  - `TaskState` gains `pendingWriteSegment?: number` — the trail index of the segment start where an unconsumed write happened.
  - Action `{ type: 'work-observed'; task: string; agentId?: string; wrote: boolean; ran: boolean; at: number }`.
  - Exported `tddTask(s: RunState, agentId?: string): TaskState | undefined` — with `agentId`: the task of an `implementer` agent record, else undefined; without: in `direct` mode during `exec`, `currentTask(s)`, else undefined.

Rules:
- **Segment** of a task: its trail after the last `brief`, `writing` or `fix` event (whole trail when none); its start index is that event's index (`-1` when none).
- `work-observed`, in this order: if `wrote` and the segment has no `red`/`green`/`refactor` → push `{ phase: 'red', at, origin: 'observed' }`; if `wrote` → `pendingWriteSegment = start`. Then if `ran` and `pendingWriteSegment === start` → clear it, and push `{ phase: 'green', at, origin: 'observed' }` unless the segment has `green` or `refactor`.
- `plan-loaded` sets `runs` on every task it lists, including tasks already active or done (today it only refreshes `title` and `steps` on those); a task the new plan gives no runs loses them.
- `phase-reported` for `red`/`green`/`refactor` (routing unchanged): if the segment already has that phase → set its newest such event's `origin` to `'reported'` (time kept), push nothing; else if the phase is `red` and the segment has `green` → nothing; else push with `origin: 'reported'`.

- [ ] **Step 1: Write the failing tests** in `tests/reduce.test.ts` (inline run built with `execRun('direct')` + `task-started` 1; SDD with an implementer dispatched on task 1):

```ts
const work = (task: string, wrote: boolean, ran: boolean, at: number, agentId?: string): Action =>
  ({ type: 'work-observed', task, wrote, ran, at, ...(agentId ? { agentId } : {}) })

test('observed work: a write gives red, a later run gives green, both observed', () => {
  // execRun('direct'), task-started 1 at 30, then:
  // work('1', true, false, 31), work('1', false, true, 32)
  // trail phases: ['brief', 'red', 'green']; origins: red 'observed', green 'observed'
})

test('a run without a write in the segment gives nothing', () => {
  // task-started 1, work('1', false, true, 31) → trail ['brief']
})

test('a write and a run in one action give red then green', () => {
  // work('1', true, true, 31) → ['brief', 'red', 'green']
})

test('a reported green after an observed one changes its origin, not the trail', () => {
  // write, run, then phase-reported green at 40 → ['brief','red','green'], green.at 32, green.origin 'reported'
})

test('a reported red after green in the same segment is ignored', () => {
  // reported red, observed write, reported green, reported red → ['brief','red','green']
})

test('a fix round starts a new segment: a stale write does not become green', () => {
  // SDD: implementer dispatched (writing), write (red), review unclean, implementer dispatched again (fix),
  // then a run with no write → no new green after 'fix'; then write, run → 'red','green' after 'fix'
})

test('plan-loaded gives runs to an active task', () => {
  // task-started 1, then plan-loaded with tasks [{ n: '1', title: 'Modèle', steps: 3, runs: ['npm test'] }] → task(s, '1').runs equals ['npm test']
})

test('tddTask routes implementers, the inline main loop, and nothing else', () => {
  // implementer of task 1 → task 1; reviewer agent → undefined; no agentId in direct exec → current task;
  // no agentId in sdd → undefined
})
```

Write each body with the existing helpers (`run`, `task`, `execRun`); assert with `task(s, '1').trail.map(e => e.phase)` and `.origin`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `claude plugin test .`
Expected: FAIL on the new tests.

- [ ] **Step 3: Implement** the types, `tddTask`, a `segmentStart(t: TaskState): number` helper, the `work-observed` case and the new `phaseReported` branch in `src/reduce.ts`. Existing reduce tests that relied on duplicate reported phases are updated to the once-per-segment rule.

- [ ] **Step 4: Run tests to verify they pass**

Run: `claude plugin test . && npm run typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add types/index.d.ts src/reduce.ts tests/reduce.test.ts
git commit -m "feat: phases carry an origin; observed work gives red and green"
```

### Task 4: Detector — emit `work-observed`

**Files:**
- Modify: `types/index.d.ts` (tool `ObservedEvent`)
- Modify: `hooks/normalize.ts`
- Modify: `src/detectors/sp-7.0.0.ts`
- Test: `tests/detect.test.ts`, `tests/hooks.test.ts` (normalize)

**Interfaces:**
- Consumes: `PlanTask.runs` (Task 1); `matchesPlanRun`, `redirectTargets`, `isWorkPath`, `isSuperpowersScript` (Task 2); `tddTask`, `work-observed` (Task 3).
- Produces: tool `ObservedEvent` gains `isDenied?: true`, set by `toolEvent` when the call was answered with `deny`.

Rules, in `toolUsed`, only when `s.stage === 'exec'` and `tddTask(s, e.agentId)` gives a task `t`:
- **Executed**: `!e.isDenied && (!e.isError || /^Exit code \d+/.test(e.text ?? ''))`.
- **wrote**: `Write` / `Edit` / `MultiEdit` / `NotebookEdit` with `!e.isError` and `isWorkPath(file_path)`; or an executed `Bash` whose `redirectTargets` has a work path.
- **ran**: an executed `Bash`, not `isSuperpowersScript`, with `matchesPlanRun(command, t.runs ?? [])`.
- Emit `{ type: 'work-observed', task: t.n, wrote, ran, agentId?, at }` only when `wrote || ran`.

- [ ] **Step 1: Write the failing tests** in `tests/detect.test.ts` (state: `exec`, mode `direct`, task 1 active with `runs: ['bats test/text.bats']`; and an SDD state with agent `impl` = implementer of task 1, agent `rev` = reviewer):

```ts
test('an Edit of a work file is a write', () => {
  // tool('Edit', { file_path: '/r/test/text.bats' }) → actions [{ type: 'work-observed', task: '1', wrote: true, ran: false, at: AT }]
})
test('a plan run that fails without a pipe still ran', () => {
  // bash('bats test/text.bats', 'Exit code 1\nnot ok 1 slugify', { isError: true }) → ran: true
})
test('a refused or denied call never counts', () => {
  // bash('cat >> test/text.bats <<\'EOF\'\nx\nEOF\nbats test/text.bats', 'Contains brace with quote character (expansion obfuscation)', { isError: true }) → no work-observed
  // bash('bats test/text.bats', 'not allowed', { isError: true, isDenied: true }) → no work-observed
})
test('a heredoc write and a run in one call give wrote and ran', () => {
  // bash("cat >> test/text.bats <<'EOF'\n@test x { true; }\nEOF\nbats test/text.bats", '1..1\nok 1 x') → wrote: true, ran: true
})
test('task-done and the ledger are not work', () => {
  // bash('…/task-done plan.md 1 abc -- bats test/text.bats', 'ok') → nothing; tool('Write', { file_path: WS + '/progress.md' }) → nothing
})
test('a reviewer running the tests is not work; an implementer is', () => {
  // SDD state: bash('bats test/text.bats', 'ok 1', { agentId: 'rev' }) → nothing;
  // same with { agentId: 'impl' } → [{ type: 'work-observed', task: '1', wrote: false, ran: true, agentId: 'impl', at: AT }]
  // same with no agentId (controller) → nothing
})
test('nothing before exec, and no run for a task without runs', () => {
  // state 'plan': tool('Edit', { file_path: '/r/src/text.sh' }) → nothing
  // exec direct, task 1 without runs: bash('bats test/text.bats', 'ok') → nothing; tool('Edit', …src…) → wrote: true, ran: false
})
```

And in `tests/hooks.test.ts`: `toolEvent` on `{ deny: 'no' }` gives `isError: true, isDenied: true, text: 'no'`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `claude plugin test .`
Expected: FAIL on the new tests.

- [ ] **Step 3: Implement** `isDenied` in `toolEvent` (`hooks/normalize.ts`) and the type; an `observeWork(e, s, d)` function in `src/detectors/sp-7.0.0.ts`, called from `toolUsed` for every tool.

- [ ] **Step 4: Run tests to verify they pass**

Run: `claude plugin test . && npm run typecheck`
Expected: PASS (including `tests/replay.test.ts` and `tests/rebuild.test.ts`; fixtures in `tests/fixtures/runs.ts` are updated only if a phase sequence they assert changes).

- [ ] **Step 5: Commit**

```bash
git add types/index.d.ts hooks/normalize.ts src/detectors/sp-7.0.0.ts tests/detect.test.ts tests/hooks.test.ts tests/fixtures/runs.ts
git commit -m "feat: detect writes and plan runs as observed work"
```

### Task 5: Trace and e2e check

**Files:**
- Modify: `types/index.d.ts` (`TraceEntry`)
- Modify: `src/trace.ts`, `src/e2e.ts`
- Modify: `tests/fixtures/runs.ts` (both runs gain a write and a plan run per task so they stay valid)
- Test: `tests/e2e.test.ts`

**Interfaces:**
- Consumes: `work-observed`, `origin` (Tasks 3–4).
- Produces: `TraceEntry` gains `reported?: ReportedPhase`, set by `traceEntry` on a `phase-reported` action. `checkTrace(entries, mode, expectedTasks)` keeps its signature.

New `checkTrace` rules: in both modes, error `task <n>: no red then green before done` for each done task whose phase list does not hold `red` then `green` (replacing the inline warning). Warning `task <n>: red/green not reported by the model` for each done task with no entry `{ action: 'phase-reported', task: n, reported: 'red' }` or none with `'green'`, reporting which are missing.

- [ ] **Step 1: Write the failing tests** in `tests/e2e.test.ts`:

```ts
test('a done task without red then green is an error, in both modes', () => {
  // DIRECT_RUN and SDD_RUN with the work events of task 2 removed:
  // expect(checkTrace(trace, mode, 3).errors).toContain('task 2: no red then green before done')
})
test('red and green observed only give a warning naming the task', () => {
  // expect(warnings).toContain('task 1: red/green not reported by the model')
})
test('traceEntry records the reported phase', () => {
  // traceEntry({ type: 'phase-reported', phase: 'green', at: 1 }, s, prev).reported === 'green'
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `claude plugin test .`
Expected: FAIL on the new tests.

- [ ] **Step 3: Implement** in `src/trace.ts` and `src/e2e.ts`; update the docblock of `checkTrace`; update `SDD_RUN` / `DIRECT_RUN` so the existing "OK" tests still pass.

- [ ] **Step 4: Run tests to verify they pass**

Run: `claude plugin test . && npm run typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add types/index.d.ts src/trace.ts src/e2e.ts tests/e2e.test.ts tests/fixtures/runs.ts
git commit -m "feat: e2e requires red then green per task and measures reports"
```

### Task 6: Track B — instruction at session and subagent start

**Files:**
- Modify: `src/instrument.ts`
- Create: `scripts/gen-context.ts`, `hooks/context/session-start.json`, `hooks/context/subagent-start.json`
- Modify: `hooks/hooks.json`, `package.json` (script `context`), `tsconfig.scripts.json` if it lists files
- Test: `tests/instrument.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `STARTUP_CONTEXT: string` in `src/instrument.ts` — exactly: `Status bar reporting (superpowers-statusbar plugin): whenever you follow superpowers test-driven-development, including when you execute a plan yourself with superpowers:executing-plans and when you implement a task as a subagent, call the mcp__superpowers-statusbar__report_phase tool each time you move into a TDD phase: red when you start writing a failing test, green when you start writing the code that makes it pass, refactor when you clean up with the tests green. It is a signal only; it changes nothing about how you work.`
  - `startupHookOutput(event: 'SessionStart' | 'SubagentStart'): string` — `JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext: STARTUP_CONTEXT } })`.
  - `WHEN.red` becomes `you start writing a failing test`, `WHEN.green` becomes `you start writing the code that makes it pass`; the rest of the description is unchanged.
  - `npm run context` writes both JSON files; `npm run context -- --check` exits 1 when a file differs.

`hooks/hooks.json`:
```json
{
  "modules": ["./register.tsx"],
  "hooks": {
    "SessionStart": [{ "matcher": "startup|resume|clear|compact", "hooks": [{ "type": "command", "command": "cat \"${CLAUDE_PLUGIN_ROOT}/hooks/context/session-start.json\"" }] }],
    "SubagentStart": [{ "hooks": [{ "type": "command", "command": "cat \"${CLAUDE_PLUGIN_ROOT}/hooks/context/subagent-start.json\"" }] }]
  }
}
```

- [ ] **Step 1: Write the failing tests** in `tests/instrument.test.ts`:

```ts
test('STARTUP_CONTEXT is the text measured in the spike', () => {
  expect(STARTUP_CONTEXT).toContain('including when you execute a plan yourself with superpowers:executing-plans and when you implement a task as a subagent')
  expect(STARTUP_CONTEXT).toContain('mcp__superpowers-statusbar__report_phase')
})
test('startupHookOutput is the hook JSON for each event', () => {
  expect(JSON.parse(startupHookOutput('SubagentStart'))).toEqual({ hookSpecificOutput: { hookEventName: 'SubagentStart', additionalContext: STARTUP_CONTEXT } })
})
test('report_phase defines red and green as the startup text does', () => {
  expect(REPORT_TOOL.description).toContain('- `red`: you start writing a failing test')
  expect(REPORT_TOOL.description).toContain('- `green`: you start writing the code that makes it pass')
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `claude plugin test .`
Expected: FAIL (`STARTUP_CONTEXT` not exported).

- [ ] **Step 3: Implement** `src/instrument.ts`, `scripts/gen-context.ts` (Node, imports `../src/instrument.ts`, writes `hooks/context/*.json`, `--check` compares), run `npm run context`, write `hooks/hooks.json`.

- [ ] **Step 4: Verify**

Run: `claude plugin test . && npm run typecheck && npm run context -- --check && claude plugin validate .`
Expected: PASS, no validation warning.

Live probe (cheap, a few cents): `cd /tmp && claude -p --plugin-dir /srv/AdrienGras/superpowers-statusbar --setting-sources project,local --model sonnet "Quote verbatim the first 8 words of any context that starts with 'Status bar reporting'. Do not call any tool." < /dev/null`
Expected: the answer quotes `Status bar reporting (superpowers-statusbar plugin): whenever you`.

- [ ] **Step 5: Commit**

```bash
git add src/instrument.ts scripts/gen-context.ts hooks/context hooks/hooks.json package.json tsconfig.scripts.json tests/instrument.test.ts
git commit -m "feat: report_phase instruction at session and subagent start"
```

### Task 7: E2E harness — bats fixture, fixture choice, stream kept

**Files:**
- Create: `e2e/fixture-bats/` (copy of the spike's `spike/fixture-bats/`: `src/text.sh`, `test/text.bats`, `docs/superpowers/specs/2026-01-01-text-sh-design.md`, `docs/superpowers/plans/2026-01-01-text-sh.md`)
- Modify: `scripts/e2e.sh`

**Interfaces:**
- Consumes: `checkTrace` rules (Task 5).
- Produces: `bash scripts/e2e.sh <superpowers folder> [sdd|direct|all] [npm|bats|all]` (fixture defaults to `all`). Trace and stream copied to `fixtures-local/e2e/<version>-<fixture>-<mode>-<stamp>.{trace,stream}.jsonl`.

Allowed tools gain `"Bash(bats *)"` and the shell commands the spike needed for SDD implementers chaining a write and a run: `cat`, `sed`, `grep`, `head`, `tail`, `ls`, `echo`, `printf` (as `"Bash(<cmd> *)"`). The script's comment says so and keeps saying it is not a sandbox. The workspace `rm -rf` rule uses the fixture's plan slug.

- [ ] **Step 1: Copy the fixture** from the spike worktree and check it

Run: `bash -n scripts/e2e.sh && (cd e2e/fixture-bats && bats test/text.bats)`
Expected: no syntax error; `1..0`.

- [ ] **Step 2: Implement** the fixture argument, the per-fixture plan path and slug, the allowed tools and the stream copy in `scripts/e2e.sh`.

- [ ] **Step 3: Verify the argument handling without spending tokens**

Run: `bash scripts/e2e.sh /nonexistent; bash scripts/e2e.sh ~/.claude/plugins/cache/superpowers-marketplace/superpowers/7.0.0 all nope`
Expected: `superpowers folder not found`, then the usage line naming `[npm|bats|all]`; exit code 2 each.

- [ ] **Step 4: Commit**

```bash
git add e2e/fixture-bats scripts/e2e.sh
git commit -m "test: e2e runs a bats fixture and keeps each stream"
```

### Task 8: Documentation

**Files:**
- Modify: `README.md` (`What the mod does` paragraph on phases; `Tests` e2e paragraph)
- Modify: `docs/superpowers/specs/2026-10-13-superpowers-statusbar-design.md` (the `report_phase` decision, marked *(#3)*)
- Modify: `.claude/CLAUDE.md` (engine constraints; e2e command and fixture list)

- [ ] **Step 1: README.** Replace the paragraph that starts "For the phases those events do not show" so it says: the model reports phases through `report_phase`, guided by a short instruction placed at the start of the session and of each subagent (about 300 tokens each) and by the tool's description; for RED/GREEN the mod also infers them from the plan's run commands: the first file written in a task means `red`, the first run of a plan command after a write means `green`. Limits, as a short list: a task whose plan gives no run command only has the phases the model reports; the mod does not read test results; `refactor` comes from the model only. In `Tests`, update the e2e paragraph: fixture argument, bats fixture, RED then GREEN per task now an error in both modes, warning when the model did not report, stream kept beside the trace, `bats` needed for the bats fixture.

- [ ] **Step 2: Reference spec.** Update the decision that puts the instructions in the tool's description: add the startup instruction and track A, marked *(#3)*, pointing to `2026-10-14-tdd-phases-design.md`.

- [ ] **Step 3: `.claude/CLAUDE.md`.** In « Contraintes du moteur »: `prompt.compose`, `prompt.context`, `prompt.section` and `prompt.attachment` are never called for a user mod; classic `SessionStart` / `SubagentStart` hooks declared in `hooks/hooks.json` beside `modules` work (`additionalContext`). In « Commandes »: `bash scripts/e2e.sh <dossier superpowers> all [npm|bats|all]`, and `npm run context` after changing `src/instrument.ts`. In « E2E »: the bats fixture, `bats` required.

- [ ] **Step 4: Verify**

Run: `claude plugin test . && npm run typecheck && claude plugin validate . && npm run context -- --check`
Expected: PASS, no warning.

- [ ] **Step 5: Commit**

```bash
git add README.md docs/superpowers/specs/2026-10-13-superpowers-statusbar-design.md .claude/CLAUDE.md
git commit -m "docs: where TDD phases come from and their limits"
```

### Task 9: Real e2e (costs tokens)

**Files:** none changed unless the run exposes a defect, which then gets its own fix with a test, in the task that owns the code.

- [ ] **Step 1: Run the e2e on both fixtures and both modes**

Run: `bash scripts/e2e.sh ~/.claude/plugins/cache/superpowers-marketplace/superpowers/7.0.0 all all`
Expected: four `E2E <fixture> <mode>: OK` lines (warnings allowed). Takes tens of minutes, costs a few dollars.

- [ ] **Step 2: Record the numbers for the PR**: per run, tasks with red then green, and how many came from the model (`reported`) versus observed only, from the kept traces in `fixtures-local/e2e/`.

- [ ] **Step 3: Remove the spike** once Task 7 has copied its fixture

Run: `git -C /srv/AdrienGras/superpowers-statusbar worktree remove --force ../superpowers-statusbar-spike3 && git -C /srv/AdrienGras/superpowers-statusbar branch -D spike/3-tdd-phases`
Expected: both succeed; `fixtures-local/spike3/` stays (gitignored data).
