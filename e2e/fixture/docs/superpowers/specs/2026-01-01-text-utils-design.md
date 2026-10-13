# Text utils — design

A tiny dependency-free ES module, `src/text.js`, with three string helpers. Tests use `node --test` and `node:assert/strict`, in `test/text.test.js`.

## Functions

- `slugify(text: string): string` — lowercase; accents removed (`Crème brûlée` → `creme-brulee`); every run of characters other than `a-z` and `0-9` becomes one `-`; no leading or trailing `-`. `slugify('Hello, World!')` is `hello-world`; `slugify('')` is `''`.
- `truncate(text: string, max: number): string` — returns `text` unchanged when it has at most `max` characters; otherwise its first `max - 1` characters followed by `…` (U+2026), so the result has exactly `max` characters. `truncate('hello world', 5)` is `hell…`. Throws a `RangeError` when `max` is less than 1.
- `wordCount(text: string): number` — the number of words, a word being a run of non-whitespace characters. `wordCount('  one two\tthree\n')` is `3`; `wordCount('')` is `0`.

## Constraints

- No dependencies; Node 22 or later.
- Named exports only.
