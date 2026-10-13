import type { AgentRoleName, ImplementerStatus } from '../types'

export type Report = { status?: ImplementerStatus; verdict?: string; isClean?: boolean }

const STATUS = /\*\*Status:\*\*\s*(DONE_WITH_CONCERNS|DONE|BLOCKED|NEEDS_CONTEXT)\b/
const TASK_QUALITY = /Task quality:?\**:?\s*(Approved|Needs fixes)/
const FIX_ROUND = /Fix round:?\**:?\s*(All findings addressed|Findings remain open)/
const READY = /Ready to merge\??:?\**:?\s*(Yes|No|With fixes)\b/

const UNCLEAN = new Set(['needs fixes', 'open', 'with fixes', 'no'])

/** True when a verdict produced by `parseReport` says the work still needs fixes. */
export function isUncleanVerdict(verdict: string | undefined): boolean {
  return verdict !== undefined && UNCLEAN.has(verdict)
}

const clean = (verdict: string): Report => ({ verdict, isClean: true })
const unclean = (verdict: string): Report => ({ verdict, isClean: false })

export function parseReport(role: AgentRoleName, answer: string): Report {
  switch (role) {
    case 'implementer': {
      const m = STATUS.exec(answer)
      return m ? { status: m[1] as ImplementerStatus } : {}
    }
    case 'reviewer': {
      if (answer.includes('❌')) return unclean('needs fixes')
      const m = TASK_QUALITY.exec(answer)
      if (!m) return {}
      return m[1] === 'Approved' ? clean('ok') : unclean('needs fixes')
    }
    case 're-reviewer': {
      const m = FIX_ROUND.exec(answer)
      if (!m) return {}
      return m[1] === 'All findings addressed' ? clean('ok') : unclean('open')
    }
    case 'final-reviewer': {
      const m = READY.exec(answer)
      if (!m) return {}
      if (m[1] === 'Yes') return clean('ready')
      return m[1] === 'With fixes' ? unclean('with fixes') : unclean('no')
    }
    default:
      return {}
  }
}
