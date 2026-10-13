import type { ObservedEvent, RunState } from '../../types'
import { reduce } from '../reduce.ts'
import { detect } from './sp-7.0.0.ts'

export { detect, MARKERS } from './sp-7.0.0.ts'
export type { Marker } from './sp-7.0.0.ts'

/**
 * Rebuilds a run from observed events. Each event's file reads are served from `files`
 * right after it, as `file` events stamped with its time; paths missing from `files` are skipped.
 * An array lists the contents successive reads of that path see; its last entry repeats.
 */
export function replay(events: ObservedEvent[], files: Record<string, string | readonly string[]> = {}): RunState | null {
  let s: RunState | null = null
  const readCounts = new Map<string, number>()
  const contentOf = (path: string): string | undefined => {
    if (!Object.hasOwn(files, path)) return undefined
    const entry = files[path]!
    if (typeof entry === 'string') return entry
    const k = readCounts.get(path) ?? 0
    readCounts.set(path, k + 1)
    return entry[Math.min(k, entry.length - 1)]
  }
  const apply = (e: ObservedEvent) => {
    const d = detect(e, s)
    for (const a of d.actions) s = reduce(s, a)
    for (const r of d.reads) {
      const text = contentOf(r.path)
      if (text !== undefined) apply({ kind: 'file', role: r.role, path: r.path, text, at: e.at })
    }
  }
  for (const e of events) apply(e)
  return s
}
