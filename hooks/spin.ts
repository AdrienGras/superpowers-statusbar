import type { RenderSurface } from 'claude-code'

/** The surfaces where a spinner `Client` failed in this copy of the module (`ui.fault`). */
const faulted = new Set<RenderSurface>()

/** Records that a spinner failed on `surface`: the band and the pane draw a still `●` there from now on. */
export function spinnerFailed(surface: RenderSurface): void {
  faulted.add(surface)
}

/** Forgets every fault recorded: for tests, so one test's fault does not reach the next. */
export function resetSpinnerFaults(): void {
  faulted.clear()
}

/** Whether `surface` animates the spinner: terminal and desktop draw a `Client`, unless one failed there. */
export function canSpin(surface: RenderSurface): surface is 'terminal' | 'desktop' {
  return (surface === 'terminal' || surface === 'desktop') && !faulted.has(surface)
}
