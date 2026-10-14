import type { PlanTask } from '../types'
import { programOf } from './tdd.ts'

const HEADING = /^#{1,6}[ \t]+Task[ \t]+([0-9]+[a-z]?)[ \t]*:?[ \t]*(.*)$/
const STEP = /^- \[[ xX]\] \*\*Step [0-9]+/
const STEP_TITLE = /^- \[[ xX]\] \*\*Step [0-9]+:?\s*(.*?)\*{0,2}\s*$/
const RUN_STEP = /\b(run|verify|confirm|lancer|lance|exécuter|vérifier)\b/i
const RUN_LINE = /^\s*(?:\*\*)?(Run|Lancer|Commande|Exécuter)(?:\*\*)?\s*:\s*(?:\*\*)?\s*`([^`]+)`/i
const FENCE = /^ {0,3}(`{3,}|~{3,})/
/** Programs that never run a task's tests: git, reading and searching, and shell syntax met in fenced scripts. */
const NOT_RUNS: ReadonlySet<string> = new Set([
  'git', 'cat', 'ls', 'grep', 'find', 'head', 'tail', 'wc', 'echo', 'printf', 'diff', 'test', '[', 'jq',
  'set', 'export', 'source', '.', 'for', 'while', 'until', 'if', 'then', 'else', 'elif', 'fi', 'do', 'done', 'case', 'esac',
])

function addRun(task: PlanTask | undefined, command: string): void {
  const cmd = command.trim()
  const program = programOf(cmd)
  if (!task || !program || NOT_RUNS.has(program)) return
  if (!task.runs) task.runs = []
  if (!task.runs.includes(cmd)) task.runs.push(cmd)
}

export function parsePlan(text: string): PlanTask[] {
  const tasks: PlanTask[] = []
  let fence: { char: string; len: number; collect: boolean } | null = null
  let runStep = false
  for (const line of text.split(/\r?\n/)) {
    const f = FENCE.exec(line)
    if (fence) {
      if (f && f[1]![0] === fence.char && f[1]!.length >= fence.len && line.trim() === f[1]) { fence = null; continue }
      if (fence.collect && !line.trimStart().startsWith('#')) addRun(tasks[tasks.length - 1], line)
      continue
    }
    if (f && !(f[1]![0] === '`' && line.slice(f[0].length).includes('`'))) {
      fence = { char: f[1]![0]!, len: f[1]!.length, collect: runStep }
      continue
    }
    const h = HEADING.exec(line)
    if (h) {
      tasks.push({ n: h[1]!, title: h[2]!.trim(), steps: 0 })
      runStep = false
      continue
    }
    if (STEP.test(line)) {
      const last = tasks[tasks.length - 1]
      if (last) last.steps++
      runStep = RUN_STEP.test(STEP_TITLE.exec(line)?.[1] ?? '')
      continue
    }
    const r = RUN_LINE.exec(line)
    if (r) addRun(tasks[tasks.length - 1], r[2]!)
  }
  return tasks
}
