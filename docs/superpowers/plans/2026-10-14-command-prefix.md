# Plan runs behind any command prefix (#18) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Track A recognises a plan task's run however it is prefixed (`rtk`, `rtk proxy`, `timeout 90`, `corepack`, `docker compose exec -T php`, `env CI=1`…), on the plan side or the executed side, and stops the false `green` that today's prefix-only keys give.

**Architecture:** All in `src/tdd.ts`. A plan run's key is no longer its first 3 words but its last 2 positional words up to its first argument path; an executed segment matches when the key's words appear in order starting at any word, never inside quoted text and never after a reading program. Words are split as the shell does (on unquoted whitespace), so a quoted string is one word.

**Tech Stack:** TypeScript (erasable only), tests with `claude-code/testing` (`claude plugin test .`), Node 24.

**Spec:** design approved in chat (session of 2026-10-14), recorded below; it amends the "Reconnaître un run" paragraph of `docs/superpowers/specs/2026-10-14-tdd-phases-design.md` (line 80), which Task 2 rewrites. Ticket: https://github.com/AdrienGras/superpowers-statusbar/issues/18.

### Design (approved)

- The mod sees the command **as the model wrote it**: classic `PreToolUse` hooks (the RTK rewrite) run beneath plugins' `tool.call` hooks (`.claude-plugin/types/claude-code/index.d.ts`, `ClassicEvent` doc). Transcripts confirm it: `input.command` is never the RTK-rewritten form.
- Measured on the user's sessions: 68 % of executed test/build segments carry a prefix (`rtk proxy`, `rtk`, `timeout N`, `pnpm exec`, `uv run`, `npx`, `corepack`, chained); 25 % of plan keys are made of prefixes only (`rtk uv run`, `docker compose exec`, `rtk corepack pnpm`), so `rtk uv run ruff` counts as the run of a plan `rtk uv run pytest tests/a.py` today.
- **Plan side, the key:** positional words of the first non-`cd` segment (flags skipped, `VAR=x` skipped, stop at the first redirection). Collection stops at the first **argument** path (a path-like word that is not the segment's first word), extended over the path-like words that follow it directly (`vendor/bin/phpunit tests/X`). The key is the **last 2** of those words (one word for a one-word command such as `pytest -x`). A key that holds no argument path requires all the plan command's flags, as a one-word key does today: otherwise `rtk proxy node --test` would key on `proxy node` and accept any `node` script.
- Equivalent wording given to the user: "the last 3 words, shortened from the left down to 2": any in-order match of a longer suffix contains the 2-word one, so the key is just the last 2. *(Planning call: the flags rule is extended from one-word keys to every key without a path.)*
- **Executed side:** the key's first word (compared by basename, `::` selector dropped) may sit at any word of a segment; the other key words follow in order (gaps allowed), exactly or as a path suffix, as today. No word before the start may be a reading program (`READERS`, below). Quoted text never matches: a quoted string is a single word.
- Misses kept on purpose (never a false phase): plan `rtk pytest` vs executed `pytest` (the key cannot drop to one word), `sh -c "…"`, `pnpm test` vs `pnpm vitest run`, RTK's own subcommands (`rtk vitest`).

## Global Constraints

- `src/` stays pure: no `$`, no Node API; erasable TypeScript only (no `enum`, no `namespace`); relative imports with `.ts`; `import type` for types.
- Rule of the project: never show false information with confidence: when in doubt, miss.
- Commit messages in English, `type: subject`.
- Version goes to `0.1.3`, same value in `package.json`, `package-lock.json` (both `version` fields) and `.claude-plugin/plugin.json`.
- Verification commands: `claude plugin test .`, `npm run typecheck`, `claude plugin validate .`.

## Review Focus

- A plan run ending on a runner path then a test file (`docker compose exec php vendor/bin/phpunit tests/X`): running another test file in the same container must not count. Pinned in Task 1 (`tests/Y` → false).
- A quoted command string (`git commit -m "fix; npm test"`, `bash -c "npm test"`, `grep -rn "pnpm vitest run" docs`): never a run. Pinned in Task 1.
- A wrapper before a reading program (`rtk git log`, `rtk read`, `timeout 5 cat`): the key must not start after `git`/`cat`/`grep`. Pinned in Task 1 (`rtk git status` vs `rtk cargo test`, `rtk git log -- cargo test`).
- A prefixed run that also redirects (`rtk proxy npm test > out.txt`): it logs the run's output, it is not a write, so no early `red`. Pinned in Task 1.
- A plan whose prefix the executor drops down to one word (`rtk pytest` → `pytest`): stays a miss, pinned so a later change does not turn it into a one-word key on a wrapper.

---

### Task 1: Prefix-tolerant run matching

**Files:**
- Modify: `src/tdd.ts` (`words`, `segmentsOf`, `keyOf`, `segmentMatches`, `runsOne`, `segmentTargets`; `MAX_KEY_WORDS` replaced)
- Modify: `src/plan.ts:11-14` (`NOT_RUNS` built from `READERS`)
- Test: `tests/tdd.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `export const READERS: ReadonlySet<string>` in `src/tdd.ts` = `git cat ls grep find head tail wc echo printf diff jq` (the reading and printing programs of today's `NOT_RUNS`). `matchesPlanRun(command: string, runs: readonly string[]): boolean` and `redirectTargets(command: string, runs?: readonly string[]): string[]` keep their signatures.

- [ ] **Step 1: Write the failing tests** (append to `tests/tdd.test.ts`; every existing test there must keep passing)

```ts
test('matchesPlanRun finds the plan run behind any prefix', () => {
  expect(matchesPlanRun('cargo test', ['rtk cargo test'])).toBe(true)
  expect(matchesPlanRun('rtk cargo test', ['cargo test'])).toBe(true)
  expect(matchesPlanRun('time npm test', ['npm test'])).toBe(true)
  expect(matchesPlanRun('env CI=1 npm test', ['npm test'])).toBe(true)
  expect(matchesPlanRun('dotenv -- pnpm vitest run src/a.test.ts', ['pnpm vitest run src/a.test.ts'])).toBe(true)
  expect(matchesPlanRun('rtk proxy pnpm vitest run src/a.test.ts', ['pnpm vitest run src/a.test.ts'])).toBe(true)
  expect(matchesPlanRun('timeout 300 pnpm build', ['pnpm build'])).toBe(true)
  expect(matchesPlanRun('corepack pnpm test src/a.test.ts', ['rtk corepack pnpm test src/a.test.ts'])).toBe(true)
  expect(matchesPlanRun('uv run pytest tests/a.py -x', ['rtk uv run pytest tests/a.py'])).toBe(true)
  expect(matchesPlanRun('python -m pytest tests/a.py', ['uv run pytest tests/a.py'])).toBe(true)
  expect(matchesPlanRun('docker compose exec -T php vendor/bin/phpunit tests/X', ['docker compose exec php vendor/bin/phpunit tests/X'])).toBe(true)
  expect(matchesPlanRun('vendor/bin/phpunit tests/X', ['./vendor/bin/phpunit tests/X'])).toBe(true)
  expect(matchesPlanRun('pytest "tests/a.py"', ['pytest tests/a.py'])).toBe(true)
})

test('matchesPlanRun never keys on prefixes alone', () => {
  expect(matchesPlanRun('rtk uv run ruff check', ['rtk uv run pytest tests/a.py'])).toBe(false)
  expect(matchesPlanRun('uv run pytest tests/b.py', ['rtk uv run pytest tests/a.py'])).toBe(false)
  expect(matchesPlanRun('pnpm lint', ['rtk corepack pnpm test'])).toBe(false)
  expect(matchesPlanRun('rtk git status', ['rtk cargo test'])).toBe(false)
  expect(matchesPlanRun('uv run python x.py', ['uv run pytest'])).toBe(false)
  expect(matchesPlanRun('docker compose exec php bin/console cache:clear', ['docker compose exec php vendor/bin/phpunit tests/X'])).toBe(false)
  expect(matchesPlanRun('docker compose exec php vendor/bin/phpunit tests/Y', ['docker compose exec php vendor/bin/phpunit tests/X'])).toBe(false)
  expect(matchesPlanRun('pytest tests/a.py', ['rtk pytest'])).toBe(false)
  expect(matchesPlanRun('rtk proxy node scripts/x.js', ['rtk proxy node --test'])).toBe(false)
  expect(matchesPlanRun('rtk proxy node --test', ['rtk proxy node --test'])).toBe(true)
})

test('matchesPlanRun never reads a run in quoted text or after a reading program', () => {
  expect(matchesPlanRun('git commit -m "fix; npm test"', ['npm test'])).toBe(false)
  expect(matchesPlanRun('bash -c "npm test"', ['npm test'])).toBe(false)
  expect(matchesPlanRun('grep -rn "pnpm vitest run" docs', ['pnpm vitest run'])).toBe(false)
  expect(matchesPlanRun('echo npm test', ['npm test'])).toBe(false)
  expect(matchesPlanRun('rtk git log -- cargo test', ['cargo test'])).toBe(false)
})

test('a prefixed plan run\'s own output redirect is not a write', () => {
  expect(redirectTargets('rtk proxy npm test > out.txt', ['npm test'])).toEqual([])
  expect(redirectTargets('timeout 90 pnpm vitest run src/a.test.ts | tee run.txt', ['pnpm vitest run src/a.test.ts'])).toEqual([])
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `claude plugin test .`
Expected: FAIL on the four new tests (e.g. `cargo test` vs `rtk cargo test` false, `rtk uv run ruff check` true); all older tests PASS.

- [ ] **Step 3: Implement in `src/tdd.ts`**

- `words(p: Piece): string[]`: split at the whitespace of `p.masked` (quoted spaces are masked, so a quoted string stays one word), take the same slices of `p.text`, strip surrounding quotes as today, drop empties, skip leading `VAR=x`. `segmentsOf` passes pieces; `segmentTargets` calls `words(s)`; `redirectTargets` calls `runsOne(words(s), keys)`.
- `keyOf(run)`: collect positional words as today (flags to `key.flags`, stop at `/[<>]/`, `dropSelector`); stop after the first path-like word at index ≥ 1 of the positional words, continuing only while the next positional words are path-like; then `key.words = collected.slice(-2)`. Record whether the collection ended on an argument path; when it did not, the key keeps the plan command's flags, all required. Remove `MAX_KEY_WORDS`.
- `segmentMatches(segment, key)`:

```ts
for (let start = 0; start < segment.length; start++) {
  const word = basename(dropSelector(segment[start]!))
  if (word === basename(key.words[0]!) && restInOrder(segment, start + 1, key)) return true
  if (READERS.has(word)) return false
}
return false
```

  where `restInOrder` is today's loop over `key.words.slice(1)` (exact or `/`-suffix for a path-like word), plus the flags check (`key.flags.every((f) => segment.includes(f))`) for a key without a path (an empty `flags` list passes).
- Update the file's header comment and the `Key` doc comment to the new rule.

In `src/plan.ts`, build `NOT_RUNS` as `new Set([...READERS, 'test', '[', 'set', 'export', …])` with today's remaining words, importing `READERS` from `./tdd.ts`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `claude plugin test .`
Expected: PASS, all suites (including `tests/detect.test.ts` and `tests/plan.test.ts`).

Run: `npm run typecheck`
Expected: exit 0, no output from `tsc`, context check OK.

- [ ] **Step 5: Commit**

```bash
git add src/tdd.ts src/plan.ts tests/tdd.test.ts
git commit -m "fix: match plan runs behind any command prefix (#18)"
```

### Task 2: Spec, version 0.1.3, full verification

**Files:**
- Modify: `docs/superpowers/specs/2026-10-14-tdd-phases-design.md:80`
- Modify: `package.json`, `package-lock.json`, `.claude-plugin/plugin.json`

**Interfaces:**
- Consumes: the matching rule of Task 1.
- Produces: nothing for other tasks.

- [ ] **Step 1: Rewrite the "Reconnaître un run" paragraph** (French, like the rest of the spec) with the rule of the Design section above: key = last 2 positional words up to the first argument path (and the paths right after it), all the plan command's flags required when the key holds no path; start at any word of the executed segment, never in quoted text nor after a reading program; the known misses. Mark the changed sentences `*(#18)*` as the spec does for earlier decisions, and keep the examples (`npm --prefix /x test`, `cd /x; npm test 2>&1 | tail`, `bats test/text.bats`) plus `rtk proxy pnpm vitest run src/a.test.ts` and `timeout 300 pnpm build`.

- [ ] **Step 2: Bump the version to `0.1.3`** in `package.json`, both `version` fields of `package-lock.json` (root and `packages[""]`), and `.claude-plugin/plugin.json`.

Run: `grep -n '"version"' package.json package-lock.json .claude-plugin/plugin.json | head -4`
Expected: four lines, all `0.1.3`.

- [ ] **Step 3: Full verification**

Run: `claude plugin test . && npm run typecheck && claude plugin validate .`
Expected: all tests pass, typecheck exit 0, validate OK.

Run: `npm run contract -- ~/.claude/plugins/cache/superpowers-marketplace/superpowers/7.0.0`
Expected: 52 OK.

Run: `npm run local`
Expected: `0 failures` (plans still parse).

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-10-14-tdd-phases-design.md package.json package-lock.json .claude-plugin/plugin.json
git commit -m "chore: v0.1.3, spec for prefix-tolerant run matching"
```
