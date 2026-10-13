import { readFileSync } from 'node:fs'

import type { Mode, TraceEntry } from '../types'
import { checkTrace } from '../src/e2e.ts'

const [path, mode, tasks] = process.argv.slice(2)
if (!path || (mode !== 'sdd' && mode !== 'direct') || !tasks || !/^[0-9]+$/.test(tasks)) {
  console.error('usage: node scripts/e2e-check.ts <trace.jsonl> <sdd|direct> <task count>')
  process.exit(2)
}

let text: string
try {
  text = readFileSync(path, 'utf8')
} catch {
  console.log(`✗ trace missing: ${path}`)
  process.exit(1)
}
let entries: TraceEntry[]
try {
  entries = text.split('\n').filter(line => line.trim() !== '').map(line => JSON.parse(line) as TraceEntry)
} catch {
  console.log(`✗ trace unreadable (invalid JSON): ${path}`)
  process.exit(1)
}

// Only errors fail the run: warnings describe the model's flow, which the mod does not control.
const { errors, warnings } = checkTrace(entries, mode satisfies Mode, Number(tasks))
for (const e of errors) console.log(`✗ ${e}`)
for (const w of warnings) console.log(`⚠ ${w}`)
process.exit(errors.length === 0 ? 0 : 1)
