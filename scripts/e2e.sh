#!/usr/bin/env bash
# E2E local : exécute le plan de e2e/fixture avec un vrai `claude -p`, le mod et une version donnée de superpowers
# chargés depuis leurs dossiers, puis vérifie la trace écrite par le mod (SP_STATUSBAR_TRACE).
# Usage : bash scripts/e2e.sh <dossier superpowers> [sdd|direct|all]
# Coûte des tokens et prend plusieurs minutes par mode.
set -uo pipefail

usage() { echo "usage: bash scripts/e2e.sh <dossier superpowers> [sdd|direct|all]" >&2; exit 2; }

[ $# -ge 1 ] || usage
SP=$(cd "$1" 2>/dev/null && pwd) || { echo "dossier superpowers introuvable : $1" >&2; exit 2; }
case "${2:-all}" in
  sdd) MODES=(sdd) ;;
  direct) MODES=(direct) ;;
  all) MODES=(sdd direct) ;;
  *) usage ;;
esac
command -v claude >/dev/null || { echo "claude introuvable" >&2; exit 2; }
command -v jq >/dev/null || { echo "jq introuvable" >&2; exit 2; }

ROOT=$(cd "$(dirname "$0")/.." && pwd)
PLAN=docs/superpowers/plans/2026-01-01-text-utils.md
TASKS=3
VERSION=$(jq -r '.version // empty' "$SP/.claude-plugin/plugin.json" 2>/dev/null)
VERSION=${VERSION:-$(basename "$SP")}
STAMP=$(date +%Y-%m-%d-%H%M%S)
TMP=$(mktemp -d "${TMPDIR:-/tmp}/sp-e2e.XXXXXX")
echo "superpowers $VERSION ($SP), dossier de travail : $TMP"

# Désactive chaque superpowers@… installé, pour que seule la version testée (--plugin-dir) soit chargée.
SETTINGS="$TMP/settings.json"
jq '{ enabledPlugins: ((.enabledPlugins // {}) | with_entries(select(.key | startswith("superpowers@")) | .value = false)) }' \
  "$HOME/.claude/settings.json" > "$SETTINGS" 2>/dev/null || echo '{ "enabledPlugins": {} }' > "$SETTINGS"

prompt() {
  local skill=subagent-driven-development
  [ "$1" = direct ] && skill=executing-plans
  echo "Execute the plan $PLAN with superpowers:$skill. Work on the current branch; do not create a worktree. Invoke superpowers scripts by their absolute path, never through a shell variable."
}

failed=0
for mode in "${MODES[@]}"; do
  repo="$TMP/$mode/repo"
  trace="$TMP/trace-$mode.jsonl"
  stream="$TMP/stream-$mode.jsonl"
  mkdir -p "$TMP/$mode"
  cp -R "$ROOT/e2e/fixture" "$repo"
  git -C "$repo" init -q
  git -C "$repo" add -A
  git -C "$repo" -c user.name=e2e -c user.email=e2e@example.invalid commit -q -m "chore: text-utils fixture"
  # Une branche de travail, comme un vrai run : sur la branche principale, la fin de branche peut être sautée.
  git -C "$repo" checkout -q -b feat/text-utils

  # Pas de bypassPermissions : un agent sans surveillance avec toutes les permissions sur la machine, c'est trop large.
  # acceptEdits (Read, Write, Edit dans le dossier du run) et une liste d'outils limitée à ce que le run demande :
  # les scripts de la version de superpowers testée, node, git, npm test, et la suppression du workspace du plan
  # (`rm -rf <workspace>`, chemin exact). Toute autre commande Bash est refusée ; le modèle passe alors par Write/Edit.
  # `rtk git` : un hook utilisateur (RTK) réécrit `git …` en `rtk git …` avant le contrôle des permissions.
  # Les règles de chemin acceptent `..` : elles cadrent un modèle de bonne foi, elles ne sont pas une frontière de sécurité.
  workspace=.superpowers/sdd/2026-01-01-text-utils
  allowed=(
    Read Write Edit Skill Agent Task SendMessage ToolSearch mcp__superpowers-statusbar__report_phase
    "Bash(bash $SP/skills/*)" "Bash($SP/skills/*)"
    "Bash(node:*)" "Bash(git:*)" "Bash(rtk git:*)" "Bash(npm test)" "Bash(npm test *)"
    "Bash(rm -rf $workspace)" "Bash(rm -rf $repo/$workspace)"
  )

  echo "E2E $mode : claude -p en cours…"
  (cd "$repo" && SP_STATUSBAR_TRACE="$trace" claude -p \
    --plugin-dir "$ROOT" --plugin-dir "$SP" \
    --settings "$SETTINGS" \
    --permission-mode acceptEdits --allowedTools "${allowed[@]}" \
    --model sonnet \
    --output-format stream-json --verbose \
    "$(prompt "$mode")" > "$stream")
  status=$?

  problems=()
  [ "$status" -eq 0 ] || problems+=("claude -p a terminé avec le code $status")
  # Le fichier de settings est pris en compte : un seul plugin superpowers, celui du dossier testé.
  loaded=$(jq -r 'select(.type == "system" and .subtype == "init") | .plugins[] | select(.name == "superpowers") | .path' "$stream" | sort -u)
  [ "$loaded" = "$SP" ] || problems+=("superpowers chargés : ${loaded:-aucun} (attendu : $SP seul)")
  # Le mod a vu l'exécution démarrer.
  jq -e -s 'any(.[]; .action == "stage-entered" and .stage == "exec")' "$trace" >/dev/null 2>&1 \
    || problems+=("la trace ne contient aucun stage-entered exec")

  if [ -f "$trace" ]; then
    mkdir -p "$ROOT/fixtures-local/e2e"
    cp "$trace" "$ROOT/fixtures-local/e2e/$VERSION-$mode-$STAMP.jsonl"
  fi

  for p in "${problems[@]}"; do echo "✗ $p"; done
  if node "$ROOT/scripts/e2e-check.ts" "$trace" "$mode" "$TASKS" && [ ${#problems[@]} -eq 0 ]; then
    echo "E2E $mode : OK"
  else
    echo "E2E $mode : échec (trace : $trace, transcript : $stream)"
    failed=1
  fi
done
exit $failed
