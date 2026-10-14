import type { PlanTask } from '../types'
import { programOf, READERS } from './tdd.ts'

const HEADING = /^#{1,6}[ \t]+Task[ \t]+([0-9]+[a-z]?)[ \t]*:?[ \t]*(.*)$/
const STEP = /^- \[[ xX]\] \*\*Step [0-9]+/
const STEP_TITLE = /^- \[[ xX]\] \*\*Step [0-9]+:?\s*(.*?)\*{0,2}\s*$/
const RUN_STEP = /\b(run|verify|confirm|lancer|lance|exécuter|vérifier)\b/i
const RUN_LINE = /^\s*(?:\*\*)?(Run|Lancer|Commande|Exécuter)(?:\*\*)?\s*:\s*(?:\*\*)?\s*`([^`]+)`/i
const FENCE = /^ {0,3}(`{3,}|~{3,})/
/** A line announcing what a command prints: the fence after it holds output, not commands. */
const OUTPUT_LINE = /^\s*(?:\*\*)?(expected|attendu|output|sortie)\b/i
const PROMPT = /^\s*\$\s+/
/** Programs that never run a task's tests: git, reading and searching, and shell syntax met in fenced scripts. */
const NOT_RUNS: ReadonlySet<string> = new Set([
  ...READERS, 'test', '[',
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
  let lastText = ''
  /** The start of a fenced run continued with `\`, until a line that does not end with one. */
  let held = ''
  for (const line of text.split(/\r?\n/)) {
    const f = FENCE.exec(line)
    if (fence) {
      if (f && f[1]![0] === fence.char && f[1]!.length >= fence.len && line.trim() === f[1]) { fence = null; held = ''; continue }
      if (!fence.collect || line.trimStart().startsWith('#')) continue
      const part = line.replace(PROMPT, '').trim()
      if (part.endsWith('\\')) { held += `${part.slice(0, -1).trim()} `; continue }
      addRun(tasks[tasks.length - 1], held + part)
      held = ''
      continue
    }
    if (f && !(f[1]![0] === '`' && line.slice(f[0].length).includes('`'))) {
      fence = { char: f[1]![0]!, len: f[1]!.length, collect: runStep && !OUTPUT_LINE.test(lastText) }
      continue
    }
    if (line.trim() !== '') lastText = line
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
