import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { checkContract } from '../src/contract.ts'
import { MARKERS } from '../src/detectors/sp-7.0.0.ts'

const root = process.argv[2]
if (!root) {
  console.error('usage: node scripts/contract-check.ts <superpowers folder>')
  process.exit(2)
}

const read = (file: string): string | undefined => {
  try {
    return readFileSync(join(root, file), 'utf8')
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw e
  }
}

const PROBLEM_TEXT = {
  'missing-file': 'missing file',
  'missing-marker': 'missing marker',
  'unreadable-file': 'unreadable file',
} as const

const problems = checkContract(MARKERS, read)
for (const p of problems) {
  console.log(`✗ ${p.id} — ${p.file}: ${PROBLEM_TEXT[p.problem]}`)
}
if (problems.length === 0) console.log(`✓ ${MARKERS.length} markers OK`)
process.exit(problems.length === 0 ? 0 : 1)
