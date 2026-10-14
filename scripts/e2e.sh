#!/usr/bin/env bash
# Local E2E: runs a fixture plan (e2e/fixture: npm, e2e/fixture-bats: bats) with a real `claude -p`, the mod and a given superpowers version loaded
# from their folders, then checks the trace the mod wrote (SP_STATUSBAR_TRACE).
# Usage: bash scripts/e2e.sh <superpowers folder> [sdd|direct|all] [npm|bats|all]
# Costs tokens and takes several minutes per mode.
set -uo pipefail

usage() { echo "usage: bash scripts/e2e.sh <superpowers folder> [sdd|direct|all] [npm|bats|all]" >&2; exit 2; }

[ $# -ge 1 ] || usage
SP=$(cd "$1" 2>/dev/null && pwd) || { echo "superpowers folder not found: $1" >&2; exit 2; }
case "${2:-all}" in
  sdd) MODES=(sdd) ;;
  direct) MODES=(direct) ;;
  all) MODES=(sdd direct) ;;
  *) usage ;;
esac
case "${3:-all}" in
  npm) FIXTURES=(npm) ;;
  bats) FIXTURES=(bats) ;;
  all) FIXTURES=(npm bats) ;;
  *) usage ;;
esac
command -v claude >/dev/null || { echo "claude not found" >&2; exit 2; }
command -v jq >/dev/null || { echo "jq not found" >&2; exit 2; }

ROOT=$(cd "$(dirname "$0")/.." && pwd)
TASKS=3
VERSION=$(jq -r '.version // empty' "$SP/.claude-plugin/plugin.json" 2>/dev/null)
VERSION=${VERSION:-$(basename "$SP")}
STAMP=$(date +%Y-%m-%d-%H%M%S)
TMP=$(mktemp -d "${TMPDIR:-/tmp}/sp-e2e.XXXXXX")
echo "superpowers $VERSION ($SP), working folder: $TMP"

# The plan slug (set per fixture in the loop) names the plan file and the workspace.
prompt() {
  local skill=subagent-driven-development
  [ "$1" = direct ] && skill=executing-plans
  echo "Execute the plan docs/superpowers/plans/$SLUG.md with superpowers:$skill. Work on the current branch; do not create a worktree. Invoke superpowers scripts by their absolute path, never through a shell variable."
}

failed=0
mkdir -p "$ROOT/fixtures-local/e2e"
for fixture in "${FIXTURES[@]}"; do
  for mode in "${MODES[@]}"; do
    case "$fixture" in
      npm) src=$ROOT/e2e/fixture SLUG=2026-01-01-text-utils ;;
      bats) src=$ROOT/e2e/fixture-bats SLUG=2026-01-01-text-sh ;;
    esac
    run=$fixture-$mode
    repo="$TMP/$run/repo"
    trace="$TMP/trace-$run.jsonl"
    stream="$TMP/stream-$run.jsonl"
    mkdir -p "$TMP/$run"
    cp -R "$src" "$repo"
    git -C "$repo" init -q
    git -C "$repo" add -A
    git -C "$repo" -c user.name=e2e -c user.email=e2e@example.invalid commit -q -m "chore: $fixture fixture"
    # A work branch, as in a real run: on the main branch, finishing may be skipped.
    git -C "$repo" checkout -q -b feat/e2e-work

    # Isolated from the personal configuration: --setting-sources project,local ignores the user settings, hence
    # their hooks (a command rewrite there changed what the permissions saw), their installed plugins (another
    # superpowers among them) and their CLAUDE.md; authentication stays. Only the mod and the tested version are loaded.
    # No bypassPermissions: an unattended agent with every permission on the machine is too broad.
    # acceptEdits (writes in the run's folder only; Write and Edit are not added, they would open every path),
    # Read (read-only, everywhere: the skills live outside the folder) and a tool list limited to what the run
    # needs: the scripts of the tested superpowers version, `node --test`, git, npm test, `bats` (the bats fixture),
    # a few shell commands (cat, sed, grep, head, tail, ls, echo, printf: SDD implementers chain a write
    # and a run in one command, and were blocked without them) and removing the plan's workspace
    # (`rm -rf <workspace>`, exact path). Other Bash commands are refused.
    # This is NOT a security boundary: `npm test` runs a package.json and tests the model writes, so do
    # `node --test` and `bats`, `sed` can write (`-i`, `w`) and run commands (`e`), the redirections of `echo` and
    # `printf` write anywhere, git takes `-C <another repo>` and `-c alias.x='!cmd'` aliases, and the path rules accept
    # `..`. The list guides a cooperative model; treat the run as unsandboxed.
    workspace=.superpowers/sdd/$SLUG
    allowed=(
      Read Skill Agent Task SendMessage ToolSearch mcp__superpowers-statusbar__report_phase
      "Bash(bash $SP/skills/*)" "Bash($SP/skills/*)"
      "Bash(node --test*)" "Bash(git:*)" "Bash(npm test)" "Bash(npm test *)"
      "Bash(bats *)" "Bash(cat *)" "Bash(sed *)" "Bash(grep *)" "Bash(head *)" "Bash(tail *)" "Bash(ls *)"
      "Bash(echo *)" "Bash(printf *)"
      "Bash(rm -rf $workspace)" "Bash(rm -rf $repo/$workspace)"
    )

    echo "E2E $run: claude -p running…"
    (cd "$repo" && SP_STATUSBAR_TRACE="$trace" claude -p \
      --plugin-dir "$ROOT" --plugin-dir "$SP" \
      --setting-sources project,local \
      --permission-mode acceptEdits --allowedTools "${allowed[@]}" \
      --model sonnet \
      --output-format stream-json --verbose \
      "$(prompt "$mode")" > "$stream")
    status=$?

    problems=()
    [ "$status" -eq 0 ] || problems+=("claude -p exited with code $status")
    # The isolation holds: one superpowers plugin, the tested folder's.
    loaded=$(jq -r 'select(.type == "system" and .subtype == "init") | .plugins[] | select(.name == "superpowers") | .path' "$stream" | sort -u)
    [ "$loaded" = "$SP" ] || problems+=("superpowers loaded: ${loaded:-none} (expected: $SP only)")
    # The mod saw the execution start.
    jq -e -s 'any(.[]; .action == "stage-entered" and .stage == "exec")' "$trace" >/dev/null 2>&1 \
      || problems+=("the trace holds no stage-entered exec")

    if [ -f "$trace" ]; then
      cp "$trace" "$ROOT/fixtures-local/e2e/$VERSION-$fixture-$mode-$STAMP.trace.jsonl"
    fi
    # The stream stays too: it is what tells afterwards why a run failed.
    [ -s "$stream" ] && cp "$stream" "$ROOT/fixtures-local/e2e/$VERSION-$fixture-$mode-$STAMP.stream.jsonl"

    # `${a[@]+…}`: under bash 3.2 and `set -u`, an empty array expanded as is counts as an unset variable.
    for p in ${problems[@]+"${problems[@]}"}; do echo "✗ $p"; done
    if node "$ROOT/scripts/e2e-check.ts" "$trace" "$mode" "$TASKS" && [ ${#problems[@]} -eq 0 ]; then
      echo "E2E $run: OK"
    else
      echo "E2E $run: failed (trace: $trace, transcript: $stream)"
      failed=1
    fi
  done
done
exit $failed
