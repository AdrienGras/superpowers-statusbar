import { test, expect } from 'claude-code/testing'

import { isSuperpowersScript, isWorkPath, matchesPlanRun, programOf, redirectTargets } from '../src/tdd.ts'

test('matchesPlanRun accepts the forms seen in real runs', () => {
  expect(matchesPlanRun('cd /r; npm test 2>&1 | tail -10', ['npm test'])).toBe(true)
  expect(matchesPlanRun('npm --prefix /tmp/x/repo test', ['npm test'])).toBe(true)
  expect(matchesPlanRun('bats test/text.bats', ['bats test/text.bats --filter slugify'])).toBe(true)
  expect(matchesPlanRun('bats /tmp/r/test/text.bats -f slugify', ['bats test/text.bats'])).toBe(true)
  expect(matchesPlanRun('uv run pytest tests/a.py -v', ['uv run pytest tests/a.py::test_x -v'])).toBe(true)
  expect(matchesPlanRun("cat >> test/t.bats <<'EOF'\n@test x {}\nEOF\nbats test/t.bats", ['bats test/t.bats'])).toBe(true)
})

test('matchesPlanRun refuses other commands', () => {
  expect(matchesPlanRun('uv run python x.py', ['uv run pytest tests/a.py'])).toBe(false)
  expect(matchesPlanRun('cat package.json', ['npm test'])).toBe(false)
  expect(matchesPlanRun('npm install', ['npm test'])).toBe(false)
  expect(matchesPlanRun('bats test/other.bats', ['bats test/text.bats'])).toBe(false)
  expect(matchesPlanRun('npm test', [])).toBe(false)
})

test('redirectTargets lists written files, not fd duplications', () => {
  expect(redirectTargets("cat >> test/text.bats <<'EOF'\nx\nEOF")).toEqual(['test/text.bats'])
  expect(redirectTargets('npm test 2>&1 | tee out.log')).toEqual(['out.log'])
  expect(redirectTargets('npm test 2>&1 | head')).toEqual([])
})

test('isWorkPath excludes the workspace, the spec and plan folders, /dev and .claude', () => {
  expect(isWorkPath('/r/src/text.sh')).toBe(true)
  expect(isWorkPath('/r/.superpowers/sdd/p/progress.md')).toBe(false)
  expect(isWorkPath('docs/superpowers/plans/p.md')).toBe(false)
  expect(isWorkPath('/dev/null')).toBe(false)
  expect(isWorkPath('/r/.claude/settings.json')).toBe(false)
  expect(isWorkPath('&1')).toBe(false)
})

test('isSuperpowersScript spots task-start and task-done', () => {
  expect(isSuperpowersScript('git commit -q -m x && /sp/skills/executing-plans/scripts/task-done plan.md 2 abc -- npm test')).toBe(true)
  expect(isSuperpowersScript('npm test')).toBe(false)
})

// --- final review fixes ---

test('a plan run\'s own output redirect is not a write', () => {
  expect(redirectTargets('npm test > /tmp/out.log 2>&1; tail /tmp/out.log', ['npm test'])).toEqual([])
  expect(redirectTargets('npm test 2>&1 | tee test-output.txt', ['npm test'])).toEqual([])
  expect(redirectTargets('bats test/text.bats > /tmp/bats.log', ['bats test/text.bats'])).toEqual([])
  expect(redirectTargets('cd /r && npm test 2>&1 | tee -a results.txt', ['npm test'])).toEqual([])
})

test('a write before the run in the same call is still a write', () => {
  expect(redirectTargets("cat >> test/t.bats <<'EOF'\n@test x { run slugify 'a > b'; }\nEOF\nbats test/t.bats", ['bats test/t.bats']))
    .toEqual(['test/t.bats'])
  expect(redirectTargets('echo x > src/a.js && npm test', ['npm test'])).toEqual(['src/a.js'])
  expect(redirectTargets('npm test > out.txt', ['bats test/t.bats'])).toEqual(['out.txt'])
})

test('isWorkPath keeps repositories under /tmp and drops log files', () => {
  expect(isWorkPath('/tmp/sp-e2e.X/npm-direct/repo/src/text.js')).toBe(true)
  expect(isWorkPath('/tmp/out.log')).toBe(false)
  expect(isWorkPath('build.log')).toBe(false)
})

test('a redirect needs a word boundary and sits outside quotes', () => {
  expect(redirectTargets('grep -rn "=> foo" src')).toEqual([])
  expect(redirectTargets('node -e "const f = x => x; console.log(f(1))"')).toEqual([])
  expect(redirectTargets("echo 'a > b' && grep -c '>>' src/a.js")).toEqual([])
  expect(redirectTargets('a=>b')).toEqual([])
  expect(redirectTargets('echo x >src/a.js')).toEqual(['src/a.js'])
  expect(redirectTargets('echo x >> "src/a b.js"')).toEqual(['src/a b.js'])
  expect(redirectTargets('make 2> err.txt')).toEqual(['err.txt'])
  expect(redirectTargets('make &> all.txt')).toEqual(['all.txt'])
  expect(redirectTargets("cat > src/a.js <<'EOF'\nconst f = x => x\nif (a > b) {}\nEOF")).toEqual(['src/a.js'])
})

test('tee is a write only as a command word', () => {
  expect(redirectTargets('grep -n tee src/x.sh')).toEqual([])
  expect(redirectTargets('echo x | tees out.txt')).toEqual([])
  expect(redirectTargets('echo tee out.txt')).toEqual([])
  expect(redirectTargets('echo x | tee -a notes.txt')).toEqual(['notes.txt'])
  expect(redirectTargets('tee src/a.txt < in.txt')).toEqual(['src/a.txt'])
})

test('redirectTargets lists /dev/null, which is no work path', () => {
  expect(redirectTargets('ls src 2>/dev/null')).toEqual(['/dev/null'])
  expect(redirectTargets('ls src 2>/dev/null').some(isWorkPath)).toBe(false)
})

test('matchesPlanRun skips VAR= chains', () => {
  expect(matchesPlanRun('CI=1 FORCE_COLOR=0 npm test', ['npm test'])).toBe(true)
  expect(matchesPlanRun('npm test', ['NODE_ENV=test npm test'])).toBe(true)
  expect(matchesPlanRun('CI=1 npm install', ['npm test'])).toBe(false)
})

test('matchesPlanRun takes any of several plan runs', () => {
  const runs = ['bats test/a.bats --filter x', 'bats test/b.bats', 'npm run lint']
  expect(matchesPlanRun('bats test/b.bats', runs)).toBe(true)
  expect(matchesPlanRun('bats /r/test/a.bats', runs)).toBe(true)
  expect(matchesPlanRun('npm run lint -- --fix', runs)).toBe(true)
  expect(matchesPlanRun('bats test/c.bats', runs)).toBe(false)
  expect(matchesPlanRun('npm run build', runs)).toBe(false)
})

test('a program-only plan run also needs its flags', () => {
  expect(matchesPlanRun('node -e "1"', ['node --test'])).toBe(false)
  expect(matchesPlanRun('node scripts/x.js', ['node --test'])).toBe(false)
  expect(matchesPlanRun('node --test', ['node --test'])).toBe(true)
  expect(matchesPlanRun('node --test 2>&1 | tail', ['node --test'])).toBe(true)
  expect(matchesPlanRun('pytest tests/a.py', ['pytest -x'])).toBe(false)
  expect(matchesPlanRun('pytest -x -q', ['pytest -x'])).toBe(true)
  expect(matchesPlanRun('pytest -q', ['pytest'])).toBe(true)
})

test('a plan run starting with cd matches on its first other segment', () => {
  expect(matchesPlanRun('cd backend && pytest tests/ -v', ['cd backend && pytest tests/'])).toBe(true)
  expect(matchesPlanRun('cd /r/backend; uv run pytest', ['cd backend && uv run pytest'])).toBe(true)
  expect(matchesPlanRun('uv run python x.py', ['cd backend && uv run pytest'])).toBe(false)
  expect(matchesPlanRun('cd backend', ['cd backend'])).toBe(false)
})

test('a plan run\'s own redirect is not part of its key', () => {
  expect(matchesPlanRun('npm test', ['npm test 2>&1 | tail -5'])).toBe(true)
  expect(matchesPlanRun('npm test', ['npm test > out.txt'])).toBe(true)
})

test('heredoc bodies and comments are neither runs nor writes', () => {
  expect(matchesPlanRun("cat > run.sh <<'EOF'\nbats test/t.bats\nEOF", ['bats test/t.bats'])).toBe(false)
  expect(matchesPlanRun('ls # then bats test/t.bats', ['bats test/t.bats'])).toBe(false)
  expect(redirectTargets('ls # > notes.txt')).toEqual([])
})

test('matchesPlanRun finds the plan run behind any prefix', () => {
  expect(matchesPlanRun('cargo test', ['rtk cargo test'])).toBe(true)
  expect(matchesPlanRun('rtk cargo test', ['cargo test'])).toBe(true)
  expect(matchesPlanRun('time npm test', ['npm test'])).toBe(true)
  expect(matchesPlanRun('env CI=1 npm test', ['npm test'])).toBe(true)
  expect(matchesPlanRun('dotenv -- pnpm vitest run src/a.test.ts', ['pnpm vitest run src/a.test.ts'])).toBe(true)
  expect(matchesPlanRun('rtk proxy pnpm vitest run src/a.test.ts', ['pnpm vitest run src/a.test.ts'])).toBe(true)
  expect(matchesPlanRun('timeout 300 pnpm build', ['pnpm build'])).toBe(true)
  expect(matchesPlanRun('corepack pnpm test src/a.test.ts', ['rtk corepack pnpm test src/a.test.ts'])).toBe(true)
  expect(matchesPlanRun('uv run pytest tests/a.py -x', ['rtk uv run pytest tests/a.py'])).toBe(true)
  expect(matchesPlanRun('python -m pytest tests/a.py', ['uv run pytest tests/a.py'])).toBe(true)
  expect(matchesPlanRun('docker compose exec -T php vendor/bin/phpunit tests/X', ['docker compose exec php vendor/bin/phpunit tests/X'])).toBe(true)
  expect(matchesPlanRun('vendor/bin/phpunit tests/X', ['./vendor/bin/phpunit tests/X'])).toBe(true)
  expect(matchesPlanRun('pytest "tests/a.py"', ['pytest tests/a.py'])).toBe(true)
})

test('matchesPlanRun never keys on prefixes alone', () => {
  expect(matchesPlanRun('rtk uv run ruff check', ['rtk uv run pytest tests/a.py'])).toBe(false)
  expect(matchesPlanRun('uv run pytest tests/b.py', ['rtk uv run pytest tests/a.py'])).toBe(false)
  expect(matchesPlanRun('pnpm lint', ['rtk corepack pnpm test'])).toBe(false)
  expect(matchesPlanRun('rtk git status', ['rtk cargo test'])).toBe(false)
  expect(matchesPlanRun('uv run python x.py', ['uv run pytest'])).toBe(false)
  expect(matchesPlanRun('docker compose exec php bin/console cache:clear', ['docker compose exec php vendor/bin/phpunit tests/X'])).toBe(false)
  expect(matchesPlanRun('docker compose exec php vendor/bin/phpunit tests/Y', ['docker compose exec php vendor/bin/phpunit tests/X'])).toBe(false)
  expect(matchesPlanRun('pytest tests/a.py', ['rtk pytest'])).toBe(false)
  expect(matchesPlanRun('rtk proxy node scripts/x.js', ['rtk proxy node --test'])).toBe(false)
  expect(matchesPlanRun('rtk proxy node --test', ['rtk proxy node --test'])).toBe(true)
})

test('matchesPlanRun never reads a run in quoted text or after a reading program', () => {
  expect(matchesPlanRun('git commit -m "fix; npm test"', ['npm test'])).toBe(false)
  expect(matchesPlanRun('bash -c "npm test"', ['npm test'])).toBe(false)
  expect(matchesPlanRun('grep -rn "pnpm vitest run" docs', ['pnpm vitest run'])).toBe(false)
  expect(matchesPlanRun('echo npm test', ['npm test'])).toBe(false)
  expect(matchesPlanRun('rtk git log -- cargo test', ['cargo test'])).toBe(false)
})

test('a prefixed plan run\'s own output redirect is not a write', () => {
  expect(redirectTargets('rtk proxy npm test > out.txt', ['npm test'])).toEqual([])
  expect(redirectTargets('timeout 90 pnpm vitest run src/a.test.ts | tee run.txt', ['pnpm vitest run src/a.test.ts'])).toEqual([])
})

test('a plan line that only reads stays no run behind a wrapper', () => {
  expect(matchesPlanRun('git status', ['rtk git status'])).toBe(false)
  expect(matchesPlanRun('git diff --stat', ['rtk git diff --stat'])).toBe(false)
  expect(matchesPlanRun('ls -la src', ['rtk ls -la src'])).toBe(false)
  expect(matchesPlanRun('cat a.txt', ['rtk cat a.txt'])).toBe(false)
  expect(matchesPlanRun('grep foo', ['timeout 5 grep foo'])).toBe(false)
  expect(matchesPlanRun('grep foo', ['/usr/bin/grep foo'])).toBe(false)
})

test('a one-word plan run is still the segment\'s program', () => {
  expect(matchesPlanRun('uv add --dev pytest', ['pytest'])).toBe(false)
  expect(matchesPlanRun('pip install pytest', ['pytest'])).toBe(false)
  expect(matchesPlanRun('npm i -D vitest', ['vitest'])).toBe(false)
  expect(matchesPlanRun('composer require --dev phpunit/phpunit', ['vendor/bin/phpunit'])).toBe(false)
  expect(matchesPlanRun('chmod +x scripts/test.sh', ['./scripts/test.sh'])).toBe(false)
  expect(matchesPlanRun('bash -n scripts/test.sh', ['./scripts/test.sh'])).toBe(false)
  expect(matchesPlanRun('./scripts/test.sh', ['./scripts/test.sh'])).toBe(true)
})

test('a plan run naming several files keeps its runner', () => {
  expect(matchesPlanRun('ruff check tests/a.py tests/b.py', ['pytest tests/a.py tests/b.py'])).toBe(false)
  expect(matchesPlanRun('black tests/a.py tests/b.py', ['uv run pytest tests/a.py tests/b.py'])).toBe(false)
  expect(matchesPlanRun('sed -n 1,40p tests/a.py tests/b.py', ['uv run pytest tests/a.py tests/b.py'])).toBe(false)
  expect(matchesPlanRun('npx prettier --write test/a.test.js test/b.test.js', ['node --test test/a.test.js test/b.test.js'])).toBe(false)
  expect(matchesPlanRun('npx eslint test/a.test.js test/b.test.js', ['npx vitest run test/a.test.js test/b.test.js'])).toBe(false)
  expect(matchesPlanRun('uv run pytest tests/a.py tests/b.py -x', ['pytest tests/a.py tests/b.py'])).toBe(true)
  expect(matchesPlanRun('pnpm exec vitest run test/a.test.js test/b.test.js', ['npx vitest run test/a.test.js test/b.test.js'])).toBe(true)
})

test('a run key never starts on a bare run or exec, and skips only flags between its words', () => {
  expect(matchesPlanRun('pnpm run lint src/a.test.ts', ['pnpm vitest run src/a.test.ts'])).toBe(false)
  expect(matchesPlanRun('npm run lint -- src/a.test.ts', ['npx vitest run src/a.test.ts'])).toBe(false)
  expect(matchesPlanRun('docker compose run test', ['npm run test'])).toBe(false)
  expect(matchesPlanRun('uv run pip install pytest', ['uv run pytest'])).toBe(false)
  expect(matchesPlanRun('npm run build -- --mode test', ['npm test'])).toBe(false)
  expect(matchesPlanRun('npx vitest run src/a.test.ts', ['pnpm vitest run src/a.test.ts'])).toBe(true)
  expect(matchesPlanRun('pnpm exec vitest run --reporter=dot src/a.test.ts', ['pnpm vitest run src/a.test.ts'])).toBe(true)
  expect(matchesPlanRun('pnpm vitest run -t slug src/a.test.ts', ['pnpm vitest run src/a.test.ts'])).toBe(true)
})

// --- #19 ---

test('export VAR=x segments are skipped like cd', () => {
  expect(matchesPlanRun('pnpm test', ['export CI=1 && pnpm test'])).toBe(true)
  expect(matchesPlanRun('pnpm test', ['cd web && export CI=1 NODE_ENV=test && pnpm test'])).toBe(true)
  expect(programOf('export CI=1 && pnpm test')).toBe('pnpm')
  expect(matchesPlanRun('export CI=1', ['export CI=1 && pnpm test'])).toBe(false)
  expect(matchesPlanRun('npm --version', ['--version'])).toBe(false)
})

test('a subshell run is a run, and its redirect only logs it', () => {
  expect(matchesPlanRun('(cd backend && pytest -x) > out.txt', ['cd backend && pytest -x'])).toBe(true)
  expect(redirectTargets('(cd backend && pytest -x) > out.txt', ['cd backend && pytest -x'])).toEqual([])
  expect(matchesPlanRun('$(npm test)', ['npm test'])).toBe(false)
})

test('isSuperpowersScript wants the script as the command', () => {
  expect(isSuperpowersScript('bash /sp/scripts/task-start plan.md 1')).toBe(true)
  expect(isSuperpowersScript('cat my-task-done')).toBe(false)
  expect(isSuperpowersScript('vim notes/task-done.md')).toBe(false)
})

test('a leading ./ is the same path on both sides', () => {
  expect(matchesPlanRun('pnpm vitest run src/a.test.ts', ['pnpm vitest run ./src/a.test.ts'])).toBe(true)
  expect(matchesPlanRun('pnpm vitest run ./src/a.test.ts', ['pnpm vitest run src/a.test.ts'])).toBe(true)
  expect(matchesPlanRun('pnpm vitest run ./', ['pnpm vitest run src/a.test.ts'])).toBe(false)
})

test('a pathless key needs only the plan command\'s own flags', () => {
  expect(matchesPlanRun('uv run pytest', ['uv run --frozen pytest'])).toBe(true)
  expect(matchesPlanRun('composer test', ['docker compose exec -T php composer test'])).toBe(true)
  expect(matchesPlanRun('npm test', ['timeout -k 5 90 npm test'])).toBe(true)
  expect(matchesPlanRun('rtk proxy node scripts/x.js', ['rtk proxy node --test'])).toBe(false)
})

test('a key never starts after a program that reads, rtk read included', () => {
  expect(matchesPlanRun('rtk read cargo test', ['cargo test'])).toBe(false)
  expect(matchesPlanRun('rg npm test', ['npm test'])).toBe(false)
  expect(matchesPlanRun('which npm test', ['npm test'])).toBe(false)
  expect(matchesPlanRun('sed -n 1p npm test', ['npm test'])).toBe(false)
})

test('quoted text and heredoc bodies are never cut into runs', () => {
  expect(redirectTargets('git commit -m "x; npm test > out.txt"', ['npm test'])).toEqual([])
  expect(matchesPlanRun('git commit -F - <<EOF\nnpm test\nEOF', ['npm test'])).toBe(false)
})

test('flags between a pathless key\'s words stay required', () => {
  expect(matchesPlanRun('cargo run -p latch --bin api', ['cargo test -p latch --test api'])).toBe(false)
  expect(matchesPlanRun('cargo build -p latch --bin api', ['cargo test -p latch --test api'])).toBe(false)
  expect(matchesPlanRun('cargo run -p server -- migrate', ['cargo test -p server --test migrate'])).toBe(false)
  expect(matchesPlanRun('cargo test -p latch --test api', ['cargo test -p latch --test api'])).toBe(true)
  expect(matchesPlanRun('npx vitest run', ['npx vitest run --coverage'])).toBe(false)
  expect(matchesPlanRun('uv run pytest', ['uv run --frozen pytest'])).toBe(true)
})
