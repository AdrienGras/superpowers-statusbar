// Pure helpers for telling when an agent wrote a work file or ran one of a
// plan task's declared commands. Deliberately strict: miss rather than be wrong.

/**
 * A slice of a shell command, two views at the same offsets: `text` with heredoc bodies and comments blanked,
 * `masked` with quoted text blanked as well, so operators are only looked for where the shell sees them.
 */
interface Piece { text: string; masked: string }

const PIPELINE_SPLIT = /&&|\|\||;|\n/g
const PIPE = /\|/g
const HEREDOC = /^<<-?[ \t]*\\?(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1/
/** `>` or `>>`, with an optional fd digit or `&`, at the start of a word. */
const REDIRECT = /(?<=^|[\s;|&(])[0-9&]?>>?/g
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/
const MAX_KEY_WORDS = 3

/** Both views of `command`: heredoc bodies and `#` comments blanked, quoted and escaped characters masked. */
function mask(command: string): Piece {
  const text = command.split('')
  const masked = command.split('')
  const blank = (from: number, to: number) => {
    for (let k = from; k < to; k++) if (command[k] !== '\n') text[k] = masked[k] = ' '
  }
  const heredocs: string[] = []
  let quote = ''
  for (let i = 0; i < command.length; i++) {
    const c = command[i]!
    if (quote) {
      if (c === quote) quote = ''
      else if (quote === '"' && c === '\\' && i + 1 < command.length) masked[i] = masked[++i] = '_'
      else masked[i] = '_'
    } else if (c === '\'' || c === '"') {
      quote = c
    } else if (c === '\\') {
      if (i + 1 < command.length) masked[++i] = '_'
    } else if (c === '#' && (i === 0 || /\s/.test(command[i - 1]!))) {
      const end = command.indexOf('\n', i)
      const stop = end < 0 ? command.length : end
      blank(i, stop)
      i = stop - 1
    } else if (c === '<' && command[i + 1] === '<') {
      const h = HEREDOC.exec(command.slice(i))
      if (h) {
        heredocs.push(h[2]!)
        i += h[0].length - 1
      } else if (command[i + 2] === '<') {
        i += 2
      }
    } else if (c === '\n' && heredocs.length > 0) {
      // The bodies start on the next line; each ends on a line holding only its delimiter.
      let at = i + 1
      for (const delimiter of heredocs) {
        while (at <= command.length) {
          const end = command.indexOf('\n', at)
          const stop = end < 0 ? command.length : end
          const line = command.slice(at, stop)
          blank(at, stop)
          at = stop + 1
          if (line.trim() === delimiter) break
        }
      }
      heredocs.length = 0
      i = at - 2
    }
  }
  return { text: text.join(''), masked: masked.join('') }
}

/** `p` cut at every match of `sep` (a global pattern), looked for in its masked view. */
function cut(p: Piece, sep: RegExp): Piece[] {
  const out: Piece[] = []
  let from = 0
  for (const m of p.masked.matchAll(sep)) {
    out.push({ text: p.text.slice(from, m.index), masked: p.masked.slice(from, m.index) })
    from = m.index + m[0].length
  }
  out.push({ text: p.text.slice(from), masked: p.masked.slice(from) })
  return out
}

/** The command's pipelines (split on `&&`, `||`, `;` and new lines), each as its `|` segments. */
const pipelinesOf = (command: string): Piece[][] => cut(mask(command), PIPELINE_SPLIT).map((p) => cut(p, PIPE))

/** A segment's words, unquoted, without the leading `VAR=x` assignments. */
function words(segment: string): string[] {
  const all = segment.trim().split(/\s+/).map((w) => w.replace(/^['"]+|['"]+$/g, '')).filter((w) => w !== '')
  let i = 0
  while (i < all.length && ASSIGNMENT.test(all[i] ?? '')) i++
  return all.slice(i)
}

/** The words of each segment of `command` that runs something, `cd` segments left out. */
function segmentsOf(command: string): string[][] {
  return pipelinesOf(command).flat().map((s) => words(s.text)).filter((w) => w.length > 0 && w[0] !== 'cd')
}

/** The program a command runs: the first word of its first segment that is not a `cd`. */
export function programOf(command: string): string | undefined {
  return segmentsOf(command)[0]?.[0]
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

/**
 * What identifies a plan run: its program and first positional words, from its first segment that is not a `cd`,
 * up to its first redirection. A key that is the program alone carries the plan command's flags, all required.
 */
interface Key { words: string[]; flags: string[] }

function keyOf(run: string): Key | undefined {
  const segment = segmentsOf(run)[0]
  if (!segment) return undefined
  const key: Key = { words: [], flags: [] }
  for (const raw of segment) {
    if (/[<>]/.test(raw)) break
    if (raw.startsWith('-')) {
      key.flags.push(raw)
      continue
    }
    const word = dropSelector(raw)
    key.words.push(word)
    if (pathLike(word) || key.words.length >= MAX_KEY_WORDS) break
  }
  return key
}

const keysOf = (runs: readonly string[]): Key[] => runs.map(keyOf).filter((k): k is Key => k !== undefined)

function segmentMatches(segment: string[], key: Key): boolean {
  const [program, first] = [segment[0], key.words[0]]
  if (program === undefined || first === undefined || basename(dropSelector(program)) !== basename(first)) return false
  if (key.words.length === 1 && !key.flags.every((f) => segment.includes(f))) return false
  let at = 1
  for (const want of key.words.slice(1)) {
    let found = false
    while (at < segment.length && !found) {
      const have = dropSelector(segment[at++] ?? '')
      found = have === want || (pathLike(want) && have.endsWith('/' + want))
    }
    if (!found) return false
  }
  return true
}

const runsOne = (segment: string[], keys: readonly Key[]) =>
  segment.length > 0 && segment[0] !== 'cd' && keys.some((key) => segmentMatches(segment, key))

export function matchesPlanRun(command: string, runs: readonly string[]): boolean {
  const keys = keysOf(runs)
  if (keys.length === 0) return false
  return segmentsOf(command).some((segment) => runsOne(segment, keys))
}

/** The file a redirection at `at` in `text` points to, quoted or bare; empty for none. */
function targetAt(text: string, at: number): string {
  while (text[at] === ' ' || text[at] === '\t') at++
  const q = text[at]
  if (q === '"' || q === '\'') {
    const end = text.indexOf(q, at + 1)
    return end < 0 ? '' : text.slice(at + 1, end)
  }
  return /^[^\s;|&<>()'"]*/.exec(text.slice(at))?.[0] ?? ''
}

/** The files a segment writes: its `>` / `>>` targets (fd duplications left out) and, if it is a `tee`, its files. */
function segmentTargets(s: Piece): string[] {
  const targets: string[] = []
  for (const m of s.masked.matchAll(REDIRECT)) {
    const after = m.index + m[0].length
    if (s.masked[after] === '&') continue
    const target = targetAt(s.text, after)
    if (target) targets.push(target)
  }
  const w = words(s.text)
  if (w[0] === 'tee') {
    for (const word of w.slice(1)) {
      if (/[<>]/.test(word)) break
      if (!word.startsWith('-')) targets.push(word)
    }
  }
  return targets
}

/**
 * The files `command` writes by redirection or `tee`. A pipeline that runs one of the plan's `runs` only logs that
 * run's output: its targets are left out, so a baseline run is never a write too.
 */
export function redirectTargets(command: string, runs: readonly string[] = []): string[] {
  const keys = keysOf(runs)
  const targets: string[] = []
  for (const pipeline of pipelinesOf(command)) {
    if (keys.length > 0 && pipeline.some((s) => runsOne(words(s.text), keys))) continue
    for (const s of pipeline) targets.push(...segmentTargets(s))
  }
  return targets
}

export function isWorkPath(path: string): boolean {
  if (path.startsWith('&') || path.startsWith('/dev/') || path.endsWith('.log')) return false
  return !/(^|\/)(\.superpowers|\.claude)\//.test(path) && !/(^|\/)docs\/superpowers\//.test(path)
}

export function isSuperpowersScript(command: string): boolean {
  return /\btask-(start|done)\b/.test(command)
}
