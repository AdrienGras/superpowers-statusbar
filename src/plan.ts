import type { PlanTask } from '../types'

const HEADING = /^#{1,6}[ \t]+Task[ \t]+([0-9]+[a-z]?)[ \t]*:?[ \t]*(.*)$/
const STEP = /^- \[[ xX]\] \*\*Step [0-9]+/
const FENCE = /^ {0,3}(`{3,}|~{3,})/

export function parsePlan(text: string): PlanTask[] {
  const tasks: PlanTask[] = []
  let fence: { char: string; len: number } | null = null
  for (const line of text.split(/\r?\n/)) {
    const f = FENCE.exec(line)
    if (fence) {
      if (f && f[1]![0] === fence.char && f[1]!.length >= fence.len && line.trim() === f[1]) fence = null
      continue
    }
    if (f && !(f[1]![0] === '`' && line.slice(f[0].length).includes('`'))) {
      fence = { char: f[1]![0]!, len: f[1]!.length }
      continue
    }
    const h = HEADING.exec(line)
    if (h) {
      tasks.push({ n: h[1]!, title: h[2]!.trim(), steps: 0 })
      continue
    }
    if (STEP.test(line)) {
      const last = tasks[tasks.length - 1]
      if (last) last.steps++
    }
  }
  return tasks
}
