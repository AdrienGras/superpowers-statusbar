# Text Utils Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Three string helpers (`slugify`, `truncate`, `wordCount`) in a dependency-free ES module.

**Architecture:** One module, `src/text.js`, with one named export per helper; one test file, `test/text.test.js`. Each task adds one helper and its tests.

**Tech Stack:** Node 22+, ES modules, `node --test`, `node:assert/strict`.

**Spec:** `docs/superpowers/specs/2026-01-01-text-utils-design.md`

## Global Constraints

- No dependencies; Node 22 or later.
- Named exports only, from `src/text.js`.
- Tests live in `test/text.test.js` and run with `npm test`.

## Review Focus

- Empty string input: each helper returns its empty result (`''` or `0`) without throwing.
- `truncate` at the boundary: a text of exactly `max` characters comes back unchanged.

---

### Task 1: slugify

**Files:**
- Modify: `src/text.js`
- Test: `test/text.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `slugify(text: string): string`, named export of `src/text.js`.

- [ ] **Step 1: Write the failing test**

Add `import { slugify } from '../src/text.js'` to the imports of `test/text.test.js`, then:

```js
test('slugify lowercases, strips accents and joins words with dashes', () => {
  assert.equal(slugify('Hello, World!'), 'hello-world')
  assert.equal(slugify('Crème brûlée'), 'creme-brulee')
  assert.equal(slugify('  --a  b--  '), 'a-b')
  assert.equal(slugify(''), '')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL, `slugify` is not exported.

- [ ] **Step 3: Implement `slugify(text: string): string` in `src/text.js`**

Remove accents with `normalize('NFD')` and dropping the combining marks (`\p{M}`).

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/text.js test/text.test.js
git commit -m "feat: slugify"
```

### Task 2: truncate

**Files:**
- Modify: `src/text.js`
- Test: `test/text.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `truncate(text: string, max: number): string`, named export of `src/text.js`.

- [ ] **Step 1: Write the failing test**

Add `truncate` to the import from `../src/text.js`, then:

```js
test('truncate cuts with an ellipsis to exactly max characters', () => {
  assert.equal(truncate('hello world', 5), 'hell…')
  assert.equal(truncate('hello', 5), 'hello')
  assert.equal(truncate('hi', 5), 'hi')
  assert.equal(truncate('', 1), '')
  assert.throws(() => truncate('hello', 0), RangeError)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL, `truncate` is not exported.

- [ ] **Step 3: Implement `truncate(text: string, max: number): string` in `src/text.js`**

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/text.js test/text.test.js
git commit -m "feat: truncate"
```

### Task 3: wordCount

**Files:**
- Modify: `src/text.js`
- Test: `test/text.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `wordCount(text: string): number`, named export of `src/text.js`.

- [ ] **Step 1: Write the failing test**

Add `wordCount` to the import from `../src/text.js`, then:

```js
test('wordCount counts runs of non-whitespace', () => {
  assert.equal(wordCount('  one two\tthree\n'), 3)
  assert.equal(wordCount('word'), 1)
  assert.equal(wordCount(''), 0)
  assert.equal(wordCount('   '), 0)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL, `wordCount` is not exported.

- [ ] **Step 3: Implement `wordCount(text: string): number` in `src/text.js`**

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/text.js test/text.test.js
git commit -m "feat: wordCount"
```
