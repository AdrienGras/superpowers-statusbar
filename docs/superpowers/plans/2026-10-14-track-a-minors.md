# Track A and e2e minors (#19) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close every box of #19: the deferred minors of #3 (track A matching and plan parsing, reducer, tests, e2e script and docs) and of #18 (prefix-tolerant matching).

**Architecture:** No new behaviour, only tightened edges. Matching stays in `src/tdd.ts`, plan parsing in `src/plan.ts`, phases in `src/reduce.ts`; task selection (`currentTask`, `tddTask`, `findTask`) moves to a new pure `src/selectors.ts` so the detector stops importing the reducer. One live check confirms the text the engine gives a failing Bash call.

**Tech Stack:** TypeScript (erasable only), `claude-code/testing` (`claude plugin test .`), Node 24, bash.

**Spec:** ticket https://github.com/AdrienGras/superpowers-statusbar/issues/19 (each box is a requirement); the user skipped the design questions ("c'est que de l'application"). Behaviour reference: `docs/superpowers/specs/2026-10-14-tdd-phases-design.md` ("Reconnaître un run", segments and phases).

## Global Constraints

- `src/` pure: no `$`, no Node API; erasable TypeScript only; relative imports with `.ts`; `import type` for types; `hooks/` may import `src/`, never the reverse.
- Never show false information with confidence: every change here either removes a false phase or turns a miss into a match without adding a false one.
- Commit messages in English, `type: subject`. Displayed text and scripts' output in English.
- Version `0.1.4` in `package.json`, both `version` fields of `package-lock.json`, `.claude-plugin/plugin.json`.
- Verification: `claude plugin test .`, `npm run typecheck`, `claude plugin validate .`.

## Decisions taken in planning (the user handed them over)

- "Consider a selectors module": yes, `src/selectors.ts` with `currentTask`, `tddTask`, `findTask` (moved, not rewritten).
- `wrote` from a Bash redirect stays **ungated** by `isSuperpowersScript` (a superpowers script line that also redirects into a work file did write it); pinned by a test.
- A pathless key requires only the plan command's flags **after its last positional word** (`node --test`, `pytest -x`), not the prefix's (`uv run --frozen pytest`, `docker compose exec -T php composer test`, `timeout -k 5 90 npm test`). The reviewer's "after the key's first word" would still require `--frozen`.
- The executed-side stop set adds `read` (for `rtk read`), `sed`, `rg`, `less`, `man`, `which`, `type` to `READERS`; plan parsing (`NOT_RUNS`) is unchanged.
- `isSuperpowersScript` is true only when a segment's program (or the script `bash`/`sh` runs) has the basename `task-start` or `task-done`.
- Expected-output fences: a fence whose last non-empty line before it starts with `Expected`, `Attendu`, `Output` or `Sortie` (optionally bold, optionally followed by `:`) collects no runs.

## Review Focus

- `export` in the middle of a plan run (`cd x && export CI=1 && pnpm test`): the run keys on `pnpm test`, never on `export`.
- A subshell run without a redirect (`(npm test)`) and a `$(npm test)` substitution: the first is a run, the second stays a miss (no new false run).
- `./` normalisation must not make a bare `./` or `.` word match anything.
- The selectors move must keep `trace.ts` and `view.ts` behaviour byte-identical (only imports change).
- A fenced block under a run step that starts with `$ ` on some lines only: only those lines lose the prompt.

---

### Task 1: Matching edges in `src/tdd.ts`

**Files:**
- Modify: `src/tdd.ts`
- Test: `tests/tdd.test.ts`

**Interfaces:**
- Produces: `READERS` (now also `read`, `sed`, `rg`, `less`, `man`, `which`, `type`); `isSuperpowersScript(command: string): boolean` (stricter); `matchesPlanRun`, `redirectTargets`, `programOf` signatures unchanged.

- [ ] **Step 1: Write the failing tests** (append to `tests/tdd.test.ts`)

```ts
test('export VAR=x segments are skipped like cd', () => {
  expect(matchesPlanRun('pnpm test', ['export CI=1 && pnpm test'])).toBe(true)
  expect(matchesPlanRun('pnpm test', ['cd web && export CI=1 NODE_ENV=test && pnpm test'])).toBe(true)
  expect(programOf('export CI=1 && pnpm test')).toBe('pnpm')
  expect(matchesPlanRun('export CI=1', ['export CI=1 && pnpm test'])).toBe(false)
})

test('a subshell run is a run, and its redirect only logs it', () => {
  expect(matchesPlanRun('(cd backend && pytest -x) > out.txt', ['cd backend && pytest -x'])).toBe(true)
  expect(redirectTargets('(cd backend && pytest -x) > out.txt', ['cd backend && pytest -x'])).toEqual([])
  expect(matchesPlanRun('$(npm test)', ['npm test'])).toBe(false)
})

test('isSuperpowersScript wants the script as the command', () => {
  expect(isSuperpowersScript('bash /sp/scripts/task-start plan.md 1')).toBe(true)
  expect(isSuperpowersScript('cat my-task-done')).toBe(false)
  expect(isSuperpowersScript('vim notes/task-done.md')).toBe(false)
})

test('a leading ./ is the same path on both sides', () => {
  expect(matchesPlanRun('pnpm vitest run src/a.test.ts', ['pnpm vitest run ./src/a.test.ts'])).toBe(true)
  expect(matchesPlanRun('pnpm vitest run ./src/a.test.ts', ['pnpm vitest run src/a.test.ts'])).toBe(true)
  expect(matchesPlanRun('pnpm vitest run ./', ['pnpm vitest run src/a.test.ts'])).toBe(false)
})

test('a pathless key needs only the plan command\'s own flags', () => {
  expect(matchesPlanRun('uv run pytest', ['uv run --frozen pytest'])).toBe(true)
  expect(matchesPlanRun('composer test', ['docker compose exec -T php composer test'])).toBe(true)
  expect(matchesPlanRun('npm test', ['timeout -k 5 90 npm test'])).toBe(true)
  expect(matchesPlanRun('rtk proxy node scripts/x.js', ['rtk proxy node --test'])).toBe(false)
})

test('a key never starts after a program that reads, rtk read included', () => {
  expect(matchesPlanRun('rtk read cargo test', ['cargo test'])).toBe(false)
  expect(matchesPlanRun('rg npm test', ['npm test'])).toBe(false)
  expect(matchesPlanRun('which npm test', ['npm test'])).toBe(false)
  expect(matchesPlanRun('sed -n 1p npm test', ['npm test'])).toBe(false)
})

test('quoted text and heredoc bodies are never cut into runs', () => {
  expect(redirectTargets('git commit -m "x; npm test > out.txt"', ['npm test'])).toEqual([])
  expect(matchesPlanRun('git commit -F - <<EOF\nnpm test\nEOF', ['npm test'])).toBe(false)
})
```

Also: a plan run made of flags only (`['--version']`) matches nothing: `expect(matchesPlanRun('npm --version', ['--version'])).toBe(false)`, in the `export` test.

- [ ] **Step 2: Run to verify they fail**

Run: `claude plugin test .`
Expected: FAIL on the export, subshell, isSuperpowersScript, `./`, flags and readers tests; the quoted/heredoc test may already pass (ledger it if so).

- [ ] **Step 3: Implement in `src/tdd.ts`**

- `words()`: drop the no-op `.trim()`; also strip leading `(` and trailing `)` with the quotes (`/^[('"]+|[)'"]+$/g`).
- `segmentsOf()`: also leave out a segment whose first word is `export` and whose other words are all `VAR=x`.
- A helper `norm(word: string): string` = `dropSelector(word)` without a leading `./`, used for key words in `keyOf` and for `have` in `restInOrder`; a word that becomes empty never matches.
- `keyOf()`: record, for each flag, how many positional words came before it; a pathless key keeps only the flags that come after its last positional word. Return `undefined` when no positional word was collected.
- `READERS`: add `read`, `sed`, `rg`, `less`, `man`, `which`, `type`. `plan.ts` builds `NOT_RUNS` from it: check that `npm run local` still reports 0 failures and that `tests/plan.test.ts` passes (it should; these programs never start a plan run).
- `isSuperpowersScript()`: true when a segment's first word, or its second word when the first is `bash` or `sh`, has the basename `task-start` or `task-done`.

- [ ] **Step 4: Run to verify they pass**

Run: `claude plugin test .`
Expected: PASS, all suites.

- [ ] **Step 5: Commit**

```bash
git add src/tdd.ts tests/tdd.test.ts
git commit -m "fix: track A matching edges: export, subshells, ./, prefix flags, readers (#19)"
```

### Task 2: Plan parsing edges in `src/plan.ts`

**Files:**
- Modify: `src/plan.ts:24-56` (`parsePlan`)
- Test: `tests/plan.test.ts`

**Interfaces:**
- Consumes: `programOf` from Task 1 (skips `export` segments).
- Produces: `parsePlan(text: string): PlanTask[]` unchanged signature.

- [ ] **Step 1: Write the failing tests** (append to `tests/plan.test.ts`)

```ts
const runsOf = (...body: string[]) =>
  parsePlan(['### Task 1: X', '- [ ] **Step 1: Run the tests**', ...body].join('\n'))[0]!.runs

test('parsePlan joins a run continued with a backslash', () => {
  expect(runsOf('```bash', 'pnpm vitest run \\', '  src/a.test.ts', '```')).toEqual(['pnpm vitest run src/a.test.ts'])
})

test('parsePlan drops a $ prompt', () => {
  expect(runsOf('```', '$ npm test', 'npm run lint', '```')).toEqual(['npm test', 'npm run lint'])
})

test('parsePlan takes no runs from an expected-output block', () => {
  expect(runsOf('Run: `npm test`', 'Expected:', '```', 'PASS src/a.test.ts', '```')).toEqual(['npm test'])
  expect(runsOf('Run: `npm test`', '**Expected output:**', '```', 'ok 1 - slugify', '```')).toEqual(['npm test'])
})

test('parsePlan keeps an export-prefixed run', () => {
  expect(runsOf('Run: `export CI=1 && pnpm test`')).toEqual(['export CI=1 && pnpm test'])
})

test('parsePlan drops git lines on their own', () => {
  expect(runsOf('```bash', 'git add -A', 'git commit -m "x"', '```')).toBeUndefined()
})

test('parsePlan lists a repeated run once', () => {
  expect(runsOf('Run: `npm test`', '```', 'npm test', '```')).toEqual(['npm test'])
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `claude plugin test .`
Expected: FAIL on the backslash, `$` prompt and expected-output tests; the export, git and de-dup tests may already pass after Task 1 (ledger which).

- [ ] **Step 3: Implement in `parsePlan`**: inside a collecting fence, a line whose trimmed end is `\` is held and joined (single spaces, each part trimmed) with the following lines until one does not end with `\`; a leading `$ ` is stripped before `addRun`. Outside fences, remember the last non-empty line; a fence opening after a line matching `/^\s*(?:\*\*)?(expected|attendu|output|sortie)\b/i` gets `collect: false`.

- [ ] **Step 4: Run to verify they pass**

Run: `claude plugin test . && npm run local`
Expected: all suites PASS; `npm run local` ends with `0 failures`.

- [ ] **Step 5: Commit**

```bash
git add src/plan.ts tests/plan.test.ts
git commit -m "fix: plan runs: continuation lines, $ prompts, expected-output blocks (#19)"
```

### Task 3: Reducer phases and a selectors module

**Files:**
- Create: `src/selectors.ts`
- Modify: `src/reduce.ts` (move `currentTask`, `compareRecency`, `lastActivity`, `tddTask`, `findTask`; TDD phase rank; stale `pendingWriteSegment`), `src/detectors/sp-7.0.0.ts:7`, `src/trace.ts:2`, `src/view.ts:2`
- Test: `tests/reduce.test.ts`

**Interfaces:**
- Produces: `src/selectors.ts` exports `currentTask(s: RunState): TaskState | undefined`, `tddTask(s: RunState, agentId?: string): TaskState | undefined`, `findTask(s: RunState, n: string): TaskState | undefined` (same bodies as today). `reduce.ts` imports them from there and no longer exports them; every importer switches to `./selectors.ts` / `../selectors.ts`.

- [ ] **Step 1: Write the failing tests** (append to `tests/reduce.test.ts`, using its `inline`, `reported`, `work`, `phasesOf` helpers)

```ts
test('a reported phase never goes back behind refactor', () => {
  expect(phasesOf(inline([reported('refactor', 31), reported('green', 32)]))).toEqual(['brief', 'refactor'])
  expect(phasesOf(inline([reported('refactor', 31), reported('red', 32)]))).toEqual(['brief', 'refactor'])
  expect(phasesOf(inline([reported('green', 31), reported('red', 32)]))).toEqual(['brief', 'green'])
})

test('a stale pending write is dropped when the segment changes', () => {
  // write in segment A, then a fix starts segment B: the pending write of A is gone at once
  const s = inline([work('1', true, false, 31), { type: 'task-started', task: '1', at: 32 }])
  expect(task(s, '1').pendingWriteSegment).toBeUndefined()
})
```

and, in SDD, a plain resume keeps the segment: an implementer `a1` dispatched on task 1, `work('1', true, false, 31, 'a1')`, `{ type: 'agent-resumed', agentId: 'a1', at: 32 }` with no review in the trail, then `work('1', false, true, 33, 'a1')` gives `['brief'…, 'red', 'green']` with no `fix` (build the run from the file's existing SDD helpers; name the test `a plain resume without an open review keeps the segment`).

Check first with a quick run that `task-started` on an active task pushes a new `brief` (a segment start); if it does not, use the action that does (`writing` or a fix through an unclean review) and ledger it.

- [ ] **Step 2: Run to verify they fail**

Run: `claude plugin test .`
Expected: FAIL on "never goes back behind refactor" (a `green` is pushed after `refactor`) and on the stale pending write; the plain-resume test may pass already (it pins behaviour: ledger it).

- [ ] **Step 3: Implement**

- One source for TDD phases: `const TDD_PHASES = ['red', 'green', 'refactor'] as const`, `type TddPhase = typeof TDD_PHASES[number]`, `TASK_PHASES` and `isTddPhase` built from it; a rank by index.
- `reportPhase`: drop the reported phase when the segment already holds a phase of higher rank (replaces the `red`-after-`green` special case).
- `push`: when the pushed event starts a segment (`brief`, `writing`, `fix`), drop `pendingWriteSegment`.
- Move the selectors to `src/selectors.ts` (it imports only types); update the four importers.

- [ ] **Step 4: Run to verify they pass**

Run: `claude plugin test . && npm run typecheck`
Expected: all PASS; typecheck exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/selectors.ts src/reduce.ts src/detectors/sp-7.0.0.ts src/trace.ts src/view.ts tests/reduce.test.ts
git commit -m "refactor: selectors module, one TDD phase list, phases never go backwards (#19)"
```

### Task 4: Detector pins

**Files:**
- Modify: `src/detectors/sp-7.0.0.ts:146-169` (`toolUsed`)
- Test: `tests/detect.test.ts` (section "observed work", helpers `work`, `observed`, `direct`, `tool`)

- [ ] **Step 1: Write the tests**

```ts
test('a background Bash run of a plan command counts as ran', () => {
  const e = tool('Bash', { command: 'bats test/text.bats', run_in_background: true }, { text: 'Command running in background with ID: b1' })
  expect(work(e, direct())).toEqual(observed(false, true))
})

test('a superpowers script line that redirects into a work file still wrote it', () => {
  const e = tool('Bash', { command: '/sp/scripts/task-done plan.md 1 abc -- bats test/text.bats && echo x > src/text.sh' })
  expect(work(e, direct())).toEqual(observed(true, false))
})
```

The `REPORT_TOOL` early return has no observable effect today (the ledger read only looks at `Write`/`Edit`/`Bash`, and `observeWork` ignores the report tool): it is a refactor covered by the existing `report_phase` tests, not a behaviour test.

- [ ] **Step 2: Run them**

Run: `claude plugin test .`
Expected: both PASS already (they pin intent; ledger it).

- [ ] **Step 3: In `toolUsed`, replace the `return d` of the `REPORT_TOOL` case with `break`.**

- [ ] **Step 4: Run**

Run: `claude plugin test .`
Expected: PASS, including the existing `report_phase` tests (`detect turns report_phase into phase-reported…`, `detect ignores report_phase with an unknown phase`).

- [ ] **Step 5: Commit**

```bash
git add src/detectors/sp-7.0.0.ts tests/detect.test.ts
git commit -m "test: pin background runs and script redirects; report_phase no longer returns early (#19)"
```

### Task 5: e2e checks, script, docs, version

**Files:**
- Modify: `tests/e2e.test.ts`, `scripts/e2e.sh:43-120`, `README.md:62`, `scripts/gen-context.ts`, `hooks/context/*.json` (regenerated), `docs/superpowers/specs/2026-10-14-tdd-phases-design.md` ("Reconnaître un run"), `package.json`, `package-lock.json`, `.claude-plugin/plugin.json`

- [ ] **Step 1: Write the tests** in `tests/e2e.test.ts`: in "red and green observed only give a warning naming the task", assert both tasks: `expect(warnings).toEqual(expect.arrayContaining(['task 1: red/green not reported by the model', 'task 2: red/green not reported by the model']))`; add `a report of only green names the missing red`, the mirror of "missing green", expecting `(missing red)` for both tasks.

- [ ] **Step 2: Run them**

Run: `claude plugin test .`
Expected: PASS (they pin `src/e2e.ts`); if one fails, the message format is the finding: fix `src/e2e.ts`.

- [ ] **Step 3: Script and docs**
  - `scripts/e2e.sh`: `mkdir -p "$ROOT/fixtures-local/e2e"` once, before the loops; re-indent the inner `for mode` loop body by two spaces. Check with `bash -n scripts/e2e.sh`.
  - `README.md:62`: say the mode argument also defaults to `all`.
  - `scripts/gen-context.ts`: content ends with `\n`; then `npm run context` and `npm run context -- --check` (✓).
  - Spec "Reconnaître un run": add, marked `*(#19)*`, the `export VAR=x` segments skipped like `cd`, subshell parentheses, `./` paths, flags of a pathless key = those after its last word, the extra readers, continuation lines, `$ ` prompts and expected-output blocks in plan parsing.
  - Version `0.1.4` in the three files (four fields).

- [ ] **Step 4: Verify**

Run: `claude plugin test . && npm run typecheck && claude plugin validate . && bash -n scripts/e2e.sh`
Expected: all PASS / OK.

- [ ] **Step 5: Commit**

```bash
git add tests/e2e.test.ts scripts/e2e.sh README.md scripts/gen-context.ts hooks/context docs/superpowers/specs/2026-10-14-tdd-phases-design.md package.json package-lock.json .claude-plugin/plugin.json
git commit -m "chore: v0.1.4, e2e checks and script fixes, context newline, spec (#19)"
```

### Task 6: Live check of a failing Bash call's text

**Files:** none in the repo (throwaway mod under `/tmp/sp-exitcode/`).

- [ ] **Step 1:** Write a throwaway mod in `/tmp/sp-exitcode/` (manifest + hooks module, same layout as this repo's `.claude-plugin/plugin.json` and `hooks/`) whose `tool.call` hook, for `Bash`, awaits `next(e)` and appends `{ command, text, isError }` as one JSON line to `/tmp/sp-exitcode/calls.jsonl`. Validate it: `claude plugin validate /tmp/sp-exitcode`.
- [ ] **Step 2:** Run, from an empty temp dir: `claude -p --plugin-dir /tmp/sp-exitcode --setting-sources project,local --model haiku --allowedTools 'Bash(node:*)' "Run exactly this shell command once, without a pipe: node -e 'process.exit(3)'"`.
Expected: `calls.jsonl` holds one line with `isError: true` and `text` starting with `Exit code 3`.
- [ ] **Step 3:** If it matches, the box is checked with this evidence (PR body). If not, the observed text is the finding: write a failing detector test with that text in `tests/detect.test.ts`, fix `isExecuted` in `src/detectors/sp-7.0.0.ts`, run the suite, commit `fix: recognise a failing Bash call as executed (#19)`.
