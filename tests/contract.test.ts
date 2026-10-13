import { test, expect } from 'claude-code/testing'

import type { Marker } from '../src/detectors/sp-7.0.0.ts'
import { checkContract } from '../src/contract.ts'

const MARKERS: Marker[] = [
  { id: 'a', file: 'skills/a/SKILL.md', pattern: /name: a/ },
  { id: 'b', file: 'skills/b/SKILL.md', pattern: /name: b/ },
]

test('checkContract passes when every marker is found', () => {
  const files: Record<string, string> = { 'skills/a/SKILL.md': 'name: a', 'skills/b/SKILL.md': '--\nname: b\n' }
  expect(checkContract(MARKERS, (f) => files[f])).toEqual([])
})

test('checkContract reports missing files and missing markers by id', () => {
  const files: Record<string, string> = { 'skills/b/SKILL.md': 'name: other' }
  expect(checkContract(MARKERS, (f) => files[f])).toEqual([
    { id: 'a', file: 'skills/a/SKILL.md', problem: 'missing-file' },
    { id: 'b', file: 'skills/b/SKILL.md', problem: 'missing-marker' },
  ])
})
