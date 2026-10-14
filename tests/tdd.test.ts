import { test, expect } from 'claude-code/testing'

import { isSuperpowersScript, isWorkPath, matchesPlanRun, redirectTargets } from '../src/tdd.ts'

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
  expect(isWorkPath('/r/.claude/settings.json')).toBe(false)
  expect(isWorkPath('&1')).toBe(false)
})

test('isSuperpowersScript spots task-start and task-done', () => {
  expect(isSuperpowersScript('git commit -q -m x && /sp/skills/executing-plans/scripts/task-done plan.md 2 abc -- npm test')).toBe(true)
  expect(isSuperpowersScript('npm test')).toBe(false)
})
