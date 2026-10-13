import type { Marker } from './detectors/sp-7.0.0.ts'

export type ContractProblem = { id: string; file: string; problem: 'missing-file' | 'missing-marker' }

/** Checks every marker against a superpowers tree; `read` returns a file's text, or undefined when the file is absent. */
export function checkContract(
  markers: readonly Marker[],
  read: (file: string) => string | undefined,
): ContractProblem[] {
  const problems: ContractProblem[] = []
  for (const { id, file, pattern } of markers) {
    const text = read(file)
    if (text === undefined) problems.push({ id, file, problem: 'missing-file' })
    else if (!pattern.test(text)) problems.push({ id, file, problem: 'missing-marker' })
  }
  return problems
}
