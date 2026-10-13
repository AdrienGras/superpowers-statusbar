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
