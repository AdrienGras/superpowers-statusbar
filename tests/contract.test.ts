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

test("checkContract ignores a marker's g or y flag", () => {
  const markers: Marker[] = [{ id: 'a', file: 'f', pattern: /x/g }]
  expect(checkContract(markers, () => 'x')).toEqual([])
  expect(checkContract(markers, () => 'x')).toEqual([])
})

test('checkContract reports a file that cannot be read apart from a missing one', () => {
  const markers: Marker[] = [{ id: 'a', file: 'f', pattern: /x/ }]
  expect(checkContract(markers, () => { throw new Error('EACCES') })).toEqual([{ id: 'a', file: 'f', problem: 'unreadable-file' }])
  expect(checkContract(markers, () => undefined)).toEqual([{ id: 'a', file: 'f', problem: 'missing-file' }])
})
