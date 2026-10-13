import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, sep } from 'node:path'

import { parsePlan } from '../src/plan.ts'
import { parseLedger } from '../src/ledger.ts'

// Output: paths, line numbers and counts only (client data).
const root = process.argv[2] ?? 'fixtures-local'
if (!existsSync(root)) {
  console.log(`${root}/ missing, nothing to test`)
  process.exit(0)
}

const LEDGER_CANDIDATE = /^\s*Task\s+[0-9]+[a-z]?:\s*(?:complete|fix round|minor|parked|Ruling)/

const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
  )

let files = 0
let recognized = 0
let failures = 0

for (const file of walk(root)) {
  const name = file.split(sep).pop() ?? ''
  const inPlans = file.split(sep).slice(0, -1).includes('plans')
  if (/^progress.*\.md$/.test(name)) {
    files++
    recognized += parseLedger(readFileSync(file, 'utf8')).length
    readFileSync(file, 'utf8')
      .split(/\r?\n/)
      .forEach((line, i) => {
        if (LEDGER_CANDIDATE.test(line) && parseLedger(line).length === 0) {
          failures++
          console.log(`✗ ${file}:${i + 1} ledger line not recognised`)
        }
      })
  } else if (inPlans) {
    files++
    if (parsePlan(readFileSync(file, 'utf8')).length === 0) {
      failures++
      console.log(`✗ ${file} no task recognised`)
    }
  }
}

console.log(`${files} files, ${recognized} lines recognised, ${failures} failures`)
process.exit(failures === 0 ? 0 : 1)
