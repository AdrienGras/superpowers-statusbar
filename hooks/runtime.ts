import type { PluginOptions } from 'claude-code'

import type { FileRequest, ObservedEvent, RunState, Stage, TraceEntry } from '../types'
import { detect } from '../src/detectors/index.ts'
import { reduce } from '../src/reduce.ts'
import { notificationFor } from '../src/notify.ts'
import { traceEntry } from '../src/trace.ts'

/**
 * What observing needs from the engine. The engine only lets `$` be passed to functions of the file that
 * hooks it, so `register.tsx` builds this from `$` (`portOf`) and hands it here.
 */
export type EnginePort = {
  /** The stored run (`read($, runAtom)`). */
  read: () => Promise<RunState | null>
  /** `update($, runAtom, change)`: `change` may run again on a version miss. */
  update: (change: (s: RunState | null) => RunState | null) => Promise<unknown>
  notify: (text: string, options: { title: string }) => Promise<unknown>
  /** The trace file the environment names (`SP_STATUSBAR_TRACE`), if any. */
  tracePath: () => Promise<string | undefined>
  /** Rejects when the file is missing. */
  readFile: (path: string) => Promise<string>
  writeFile: (path: string, text: string) => Promise<void>
  /** Told, once the step is written, that the run entered `stage`; never awaited. */
  entered: (stage: Stage) => void
}

/** What one event did to the run: the state before and after, a trace entry per action, the files to read. */
type Step = { prev: RunState | null; next: RunState | null; entries: TraceEntry[]; reads: FileRequest[] }

function step(prev: RunState | null, e: ObservedEvent): Step {
  const d = detect(e, prev)
  let next = prev
  const entries: TraceEntry[] = []
  for (const a of d.actions) {
    const before = next
    next = reduce(next, a)
    entries.push({ ...traceEntry(a, next, before), via: e.kind })
  }
  return { prev, next, entries, reads: d.reads }
}

/**
 * Applies `e` to the run against its latest state. An event that changes nothing is settled on the value read;
 * one that does goes through `update`, whose function may run again on a version miss: the step kept is the one
 * computed from the value actually replaced.
 */
async function apply(port: EnginePort, e: ObservedEvent): Promise<Step> {
  const seen = step(await port.read(), e)
  if (seen.entries.length === 0) return seen
  const written: { step?: Step } = {}
  await port.update(s => (written.step = step(s, e)).next)
  return written.step ?? seen
}

/** Trace lines of this copy of the module since the run began (the file is rewritten whole each time). */
const traceLines: string[] = []
let inFlight: Promise<void> | undefined
let queued: Promise<void> | undefined

/** Forgets the lines so far: a new run (after `/clear`) starts a new trace. */
export function resetTrace(): void {
  traceLines.length = 0
}

/**
 * Writes every line so far. Writes land in order and coalesce: while one is in flight, the lines that come meanwhile
 * wait for one more write, which carries them all.
 */
function writeTrace(port: EnginePort, path: string): Promise<void> {
  if (queued) return queued
  if (inFlight) {
    queued = inFlight.catch(() => {}).then(() => {
      queued = undefined
      return writeTrace(port, path)
    })
    return queued
  }
  const write = (async () => port.writeFile(path, `${traceLines.join('\n')}\n`))()
  inFlight = write.finally(() => { inFlight = undefined })
  return inFlight
}

async function trace(port: EnginePort, entries: readonly TraceEntry[]) {
  if (entries.length === 0) return
  const path = await port.tracePath()
  if (!path) return
  traceLines.push(...entries.map(entry => JSON.stringify(entry)))
  await writeTrace(port, path)
}

/** Swallows a side effect's failure: observing never fails the hook that observes. */
const quietly = (work: Promise<unknown>) => work.then(() => {}, () => {})

/**
 * Feeds one observed event to the run: detection and reduction on the stored state, `port.entered` when the run
 * changed stage, a notification when the run enters a wait worth one (and `options.notifications` is on), a trace
 * line per action when `SP_STATUSBAR_TRACE` names a file, then each file the detectors asked for, read through the
 * engine and fed back as a `file` event (a missing file is skipped). Never rejects.
 */
export async function observe(port: EnginePort, e: ObservedEvent, options: PluginOptions): Promise<void> {
  let done: Step
  try {
    done = await apply(port, e)
  } catch {
    return
  }
  if (done.next && done.next.stage !== done.prev?.stage) {
    try {
      port.entered(done.next.stage)
    } catch {}
  }
  // Started first, awaited last: a notification slow or throwing must not hold back the trace and the reads.
  const text = notificationFor(done.prev, done.next)
  const notified = text !== undefined && options.notifications === true
    ? quietly((async () => port.notify(text, { title: 'superpowers' }))())
    : undefined
  await quietly(trace(port, done.entries))
  for (const r of done.reads) {
    let content: string
    try {
      content = await port.readFile(r.path)
    } catch {
      continue
    }
    await observe(port, { kind: 'file', role: r.role, path: r.path, text: content, at: e.at }, options)
  }
  await notified
}
