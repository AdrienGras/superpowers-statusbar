import type { Decision, LedgerLine } from '../types'

const TASK = '([0-9]+[a-z]?)'
const COMPLETE = new RegExp(`^\\s*Task\\s+${TASK}:\\s*complete\\b`)
const FIX_ROUND = new RegExp(`^\\s*Task\\s+${TASK}:\\s*fix round\\s+([0-9]+)`)
const PARKED = new RegExp(`^\\s*Task\\s+${TASK}:\\s*parked\\s*[—-]\\s*(.+?)\\s*$`)
const MINOR = new RegExp(`^\\s*(?:Task\\s+${TASK}|Final):\\s*minor(?:\\s*\\(deferred\\))?\\s*:\\s*(.+?)\\s*$`)
const RULING = new RegExp(`^\\s*(?:Task\\s+${TASK}:\\s*)?Ruling:\\s*(.+?)\\s*$`)

function parseLine(line: string): LedgerLine | null {
  let m = COMPLETE.exec(line)
  if (m) return { kind: 'complete', task: m[1]! }
  m = FIX_ROUND.exec(line)
  if (m) return { kind: 'fix-round', task: m[1]!, round: Number(m[2]) }
  m = PARKED.exec(line)
  if (m) return { kind: 'parked', task: m[1]!, text: m[2]! }
  m = MINOR.exec(line)
  if (m) return m[1] ? { kind: 'minor', task: m[1], text: m[2]! } : { kind: 'minor', text: m[2]! }
  m = RULING.exec(line)
  if (m) return m[1] ? { kind: 'ruling', task: m[1], text: m[2]! } : { kind: 'ruling', text: m[2]! }
  return null
}

export function parseLedger(text: string): LedgerLine[] {
  const out: LedgerLine[] = []
  for (const line of text.split(/\r?\n/)) {
    const parsed = parseLine(line)
    if (parsed) out.push(parsed)
  }
  return out
}

export function decisionsOf(lines: LedgerLine[]): Decision[] {
  const out: Decision[] = []
  for (const l of lines) {
    if (l.kind === 'minor' || l.kind === 'parked' || l.kind === 'ruling') out.push(l)
  }
  return out
}
