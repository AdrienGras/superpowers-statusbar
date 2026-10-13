import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, sep } from 'node:path'

import { parsePlan } from '../src/plan.ts'
import { parseLedger } from '../src/ledger.ts'

// Sortie : uniquement chemins, numéros de ligne et compteurs (données client).
const root = process.argv[2] ?? 'fixtures-local'
if (!existsSync(root)) {
  console.log(`${root}/ absent, rien à tester`)
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
          console.log(`✗ ${file}:${i + 1} ligne de ledger non reconnue`)
        }
      })
  } else if (inPlans) {
    files++
    if (parsePlan(readFileSync(file, 'utf8')).length === 0) {
      failures++
      console.log(`✗ ${file} aucune tâche reconnue`)
    }
  }
}

console.log(`${files} fichiers, ${recognized} lignes reconnues, ${failures} échecs`)
process.exit(failures === 0 ? 0 : 1)
