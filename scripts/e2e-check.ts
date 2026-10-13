import { readFileSync } from 'node:fs'

import type { Mode, TraceEntry } from '../types'
import { checkTrace } from '../src/e2e.ts'

const [path, mode, tasks] = process.argv.slice(2)
if (!path || (mode !== 'sdd' && mode !== 'direct') || !tasks || !/^[0-9]+$/.test(tasks)) {
  console.error('usage: node scripts/e2e-check.ts <trace.jsonl> <sdd|direct> <nombre de tâches>')
  process.exit(2)
}

let text: string
try {
  text = readFileSync(path, 'utf8')
} catch {
  console.log(`✗ trace absente : ${path}`)
  process.exit(1)
}
const entries = text.split('\n').filter(line => line.trim() !== '').map(line => JSON.parse(line) as TraceEntry)

const problems = checkTrace(entries, mode satisfies Mode, Number(tasks))
for (const p of problems) console.log(`✗ ${p}`)
process.exit(problems.length === 0 ? 0 : 1)
