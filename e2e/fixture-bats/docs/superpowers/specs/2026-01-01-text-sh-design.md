# Text helpers in bash — design

A tiny bash library, `src/text.sh`, with three string helpers, each a function that prints its result on stdout. Tests use [bats](https://github.com/bats-core/bats-core), in `test/text.bats`.

## Functions

- `slugify TEXT` — lowercase; every run of characters other than `a-z` and `0-9` becomes one `-`; no leading or trailing `-`. `slugify 'Hello, World!'` prints `hello-world`; `slugify ''` prints nothing.
- `truncate TEXT MAX` — prints `TEXT` unchanged when it has at most `MAX` characters; otherwise its first `MAX - 3` characters followed by `...`, so the result has exactly `MAX` characters. `truncate 'hello world' 8` prints `hello...`. When `MAX` is less than 4, prints `truncate: max must be at least 4` on stderr and returns 1.
- `word_count TEXT` — prints the number of words, a word being a run of non-whitespace characters. `word_count '  one two	three'` prints `3`; `word_count ''` prints `0`.

## Constraints

- Bash 4 or later, no external dependency beyond coreutils, `sed` and `tr`.
- Functions only: sourcing `src/text.sh` runs nothing.
