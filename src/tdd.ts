// Pure helpers for telling when an agent wrote a work file or ran one of a
// plan task's declared commands. Deliberately strict: miss rather than be wrong.

const SEGMENT_SPLIT = /&&|\|\||;|\||\n/
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/
const REDIRECT = /(?:^|[^0-9&])(?:>>?|\btee(?: -a)?)\s*['"]?([^\s'";|&<>]+)/g
const MAX_KEY_WORDS = 3

function words(segment: string): string[] {
  const all = segment.trim().split(/\s+/).map((w) => w.replace(/^['"]+|['"]+$/g, '')).filter((w) => w !== '')
  let i = 0
  while (i < all.length && ASSIGNMENT.test(all[i] ?? '')) i++
  return all.slice(i)
}

function segmentsOf(command: string): string[][] {
  return command.split(SEGMENT_SPLIT).map(words).filter((w) => w.length > 0 && w[0] !== 'cd')
}

function pathLike(word: string): boolean {
  return /[/.:]/.test(word)
}

function dropSelector(word: string): string {
  const at = word.indexOf('::')
  return at < 0 ? word : word.slice(0, at)
}

function basename(word: string): string {
  return word.slice(word.lastIndexOf('/') + 1)
}

function keyOf(run: string): string[] {
  const key: string[] = []
  for (const raw of words(run)) {
    if (raw.startsWith('-')) continue
    const word = dropSelector(raw)
    key.push(word)
    if (pathLike(word) || key.length >= MAX_KEY_WORDS) break
  }
  return key
}

function segmentMatches(segment: string[], key: string[]): boolean {
  const [program, first] = [segment[0], key[0]]
  if (program === undefined || first === undefined || basename(dropSelector(program)) !== basename(first)) return false
  let at = 1
  for (const want of key.slice(1)) {
    let found = false
    while (at < segment.length && !found) {
      const have = dropSelector(segment[at++] ?? '')
      found = have === want || (pathLike(want) && have.endsWith('/' + want))
    }
    if (!found) return false
  }
  return true
}

export function matchesPlanRun(command: string, runs: readonly string[]): boolean {
  const keys = runs.map(keyOf).filter((k) => k.length > 0)
  if (keys.length === 0) return false
  return segmentsOf(command).some((segment) => keys.some((key) => segmentMatches(segment, key)))
}

export function redirectTargets(command: string): string[] {
  const targets: string[] = []
  for (const m of command.matchAll(REDIRECT)) {
    const target = m[1]
    if (target !== undefined && !target.startsWith('&')) targets.push(target)
  }
  return targets
}

export function isWorkPath(path: string): boolean {
  if (path.startsWith('&') || path.startsWith('/dev/')) return false
  return !/(^|\/)(\.superpowers|\.claude)\//.test(path) && !/(^|\/)docs\/superpowers\//.test(path)
}

export function isSuperpowersScript(command: string): boolean {
  return /\btask-(start|done)\b/.test(command)
}
