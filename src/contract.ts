import type { Marker } from './detectors/sp-7.0.0.ts'

export type ContractProblem = { id: string; file: string; problem: 'missing-file' | 'missing-marker' | 'unreadable-file' }

/** Checks every marker against a superpowers tree; `read` returns a file's text, or undefined when the file is absent; it throws on any other read error. */
export function checkContract(
  markers: readonly Marker[],
  read: (file: string) => string | undefined,
): ContractProblem[] {
  const problems: ContractProblem[] = []
  for (const { id, file, pattern } of markers) {
    let text: string | undefined
    try {
      text = read(file)
    } catch {
      problems.push({ id, file, problem: 'unreadable-file' })
      continue
    }
    if (text === undefined) problems.push({ id, file, problem: 'missing-file' })
    else if (!new RegExp(pattern.source, pattern.flags.replace(/[gy]/g, '')).test(text)) problems.push({ id, file, problem: 'missing-marker' })
  }
  return problems
}
