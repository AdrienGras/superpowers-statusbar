import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { startupHookOutput } from '../src/instrument.ts'

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'hooks', 'context')
const files = [
  ['session-start.json', `${startupHookOutput('SessionStart')}\n`],
  ['subagent-start.json', `${startupHookOutput('SubagentStart')}\n`],
] as const

const check = process.argv.includes('--check')
let differs = false
for (const [name, content] of files) {
  const path = join(dir, name)
  if (check) {
    let current: string | undefined
    try {
      current = readFileSync(path, 'utf8')
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
    }
    if (current !== content) {
      console.log(`✗ ${name} differs from src/instrument.ts, run: npm run context`)
      differs = true
    }
  } else {
    mkdirSync(dir, { recursive: true })
    writeFileSync(path, content)
    console.log(`wrote hooks/context/${name}`)
  }
}
if (check && !differs) console.log(`✓ ${files.length} context files up to date`)
process.exit(differs ? 1 : 0)
