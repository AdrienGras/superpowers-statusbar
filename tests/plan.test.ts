import { test, expect } from 'claude-code/testing'

import { parsePlan } from '../src/plan.ts'

const steps = (n: number) =>
  Array.from({ length: n }, (_, i) => `- [ ] **Step ${i + 1}: do it**`).join('\n')

test('parsePlan reads ### Task headings with titles and step counts', () => {
  const text = `# Plan\n\n### Task 1: Modèle\n\n${steps(3)}\n\n### Task 2: Repository\n\n${steps(2)}\n`
  expect(parsePlan(text)).toEqual([
    { n: '1', title: 'Modèle', steps: 3 },
    { n: '2', title: 'Repository', steps: 2 },
  ])
})

test('parsePlan mixes ## and ### headings and suffixed tasks', () => {
  const text = `## Task 1: A\n${steps(1)}\n### Task 3a: B\n${steps(1)}\n### Task 3b: C\n${steps(1)}\n`
  expect(parsePlan(text).map(t => t.n)).toEqual(['1', '3a', '3b'])
})

test('parsePlan ignores headings inside fences, including four-backtick fences', () => {
  const text = [
    '### Task 1: Réel',
    steps(1),
    '````markdown',
    '```',
    'inner',
    '```',
    '### Task 9: Faux',
    '- [ ] **Step 1: faux**',
    '````',
    '### Task 2: Suite',
    steps(2),
  ].join('\n')
  expect(parsePlan(text)).toEqual([
    { n: '1', title: 'Réel', steps: 1 },
    { n: '2', title: 'Suite', steps: 2 },
  ])
})

test('parsePlan returns [] for text with no task heading', () => {
  expect(parsePlan('# Title\n\nsome text\n')).toEqual([])
})

test('parsePlan hides headings inside a tilde fence', () => {
  expect(parsePlan('~~~\n### Task 9: Hidden\n~~~\n### Task 1: Shown')).toEqual([{ n: '1', title: 'Shown', steps: 0 }])
})

test('parsePlan keeps a fence open on a shorter closing fence', () => {
  const text = '````\n```\n### Task 9: Hidden\n````\n### Task 1: Shown'
  expect(parsePlan(text).map(t => t.n)).toEqual(['1'])
})

test('parsePlan does not open a backtick fence whose info string has a backtick', () => {
  expect(parsePlan('```js `x`\n### Task 1: Shown')).toEqual([{ n: '1', title: 'Shown', steps: 0 }])
})

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

test('parsePlan drops read-only commands, shell keywords and cd-only lines from runs', () => {
  const text = [
    '### Task 1: Recettes',
    '- [ ] **Step 2: Run the test to verify it fails**',
    'Run: `grep -n slugify src/text.sh`',
    'Run: `cat package.json`',
    '```bash',
    'set -euo pipefail',
    'cd backend',
    'for f in test/*.bats; do',
    '  bats "$f"',
    'done',
    'if [ -f x ]; then',
    'fi',
    'export CI=1',
    'source .venv/bin/activate',
    'ls tests/ && find . -name "*.py" | head',
    'echo ok; printf "x"; wc -l src/a.py; tail -5 log; head -3 log; diff a b; test -f x; [ -d y ]; jq . a.json',
    'cd backend && pytest tests/ -x',
    'CI=1 npm test',
    '```',
  ].join('\n')
  expect(parsePlan(text)[0]!.runs).toEqual(['bats "$f"', 'cd backend && pytest tests/ -x', 'CI=1 npm test'])
})
