# superpowers-statusbar

Mod Claude Code (plugin de hooks de fonctions, API `claude-code`, Claude Code 2.1.296) qui suit un run superpowers 7.0.0 et l'affiche : une bande d'une ligne au-dessus du prompt, un pane latéral (`/sp-progress`) et des notifications système quand le run attend la personne. Le dépôt est public : https://github.com/AdrienGras/superpowers-statusbar

- Design : `docs/superpowers/specs/2026-10-13-superpowers-statusbar-design.md`. Il est à jour avec ce qui a été construit, et les décisions prises pendant l'implémentation y sont marquées.
- Suivi : projet GitHub https://github.com/users/AdrienGras/projects/5. Les tickets #2 à #15 contiennent les bugs connus, la dette et la roadmap. Avant de chercher un problème, regarder s'il y a déjà un ticket.

## Architecture

```
events Claude Code ──► hooks/normalize.ts ──► ObservedEvent
                                                 │
src/detectors/sp-7.0.0.ts (détecteurs + MARKERS) ─┤
                                                 ▼
                         src/reduce.ts (reducer pur) ──► RunState dans $.state
                                                 │
            src/view.ts (modèles de vue) ──► hooks/band.tsx, hooks/pane.tsx, hooks/spinner.tsx
            src/notify.ts (attente, notifications)
```

- `src/` est le cœur pur : parseurs `plan.ts` et `ledger.ts`, détecteurs, reducer, `reports.ts`, vues, `rebuild.ts`, `contract.ts`, `e2e.ts`, `trace.ts`, `instrument.ts`. Les règles :
  - aucun `$` ni API Node ;
  - TypeScript effaçable uniquement : pas d'`enum`, pas de `namespace` ;
  - imports relatifs avec l'extension `.ts`, `import type` pour les types ;
  - `hooks/` peut importer `src/`, l'inverse jamais.
- `hooks/` est la couche mod. `register.tsx` câble tout, et `runtime.ts` contient `observe`, qui passe par un `EnginePort`.
- `types/index.d.ts` est le contrat `PluginState` (clé `superpowers-statusbar` : `run`, `isPaneOpen`) et tous les types du modèle.
- `scripts/` contient les outils de dev, en Node 24 qui exécute le TypeScript directement.

## Contraintes du moteur (constatées au chargement, non négociables)

- `$` ne peut pas être passé à une fonction définie dans un autre fichier. On passe un `EnginePort` construit par `portOf($)` dans `register.tsx`.
- `read` et `update` n'acceptent qu'un atom déclaré dans le même fichier, avec la référence littérale `{ plugin, key }`. Chaque fichier de rendu déclare donc son propre atom.
- Un hook défini dans un autre fichier et passé directement à `on(...)` se charge sans problème.
- `skill.prompt` est **contourné** par le plugin de sécurité intégré à Claude Code (`cc-plugin-sec-default`) pour les mods utilisateur. Conséquences :
  - le mod ne réécrit jamais le texte d'un skill ;
  - l'entrée dans un skill est détectée sur `tool.call` `Skill` (skill lancé par le modèle, porte l'`agentId`) et sur `command.run` (skill tapé `/superpowers:…`) ; `skill.prompt` n'est plus observé ;
  - les débuts de dispatch viennent de `agent.spawn`, l'appel d'outil `Agent` apportant la réponse en avant-plan ou servant de repli ;
  - les phases (brainstorming, plan, TDD) arrivent par l'outil `mcp__superpowers-statusbar__report_phase`, dont la **description** contient les consignes (`isDeferred: false`).
- Une réponse de plugin à `tool.call` est `{ result: ... }`. Le `text` de premier niveau est réservé au moteur.
- Les déclarations de l'API sont dans `.claude-plugin/types/claude-code/index.d.ts` (gitignoré, environ 21 000 lignes, à parcourir avec grep). Le moteur les régénère à chaque chargement du mod via `--plugin-dir`.

## Commandes

```bash
claude plugin test .          # npm test — tous les *.test.ts(x)
npm run typecheck             # tsc du mod + des scripts
claude plugin validate .      # npm run validate
npm run contract -- ~/.claude/plugins/cache/superpowers-marketplace/superpowers/7.0.0   # marqueurs superpowers (47 OK)
npm run local                 # parseurs sur données réelles de fixtures-local/ (n'affiche jamais leur contenu)
bash scripts/e2e.sh <dossier superpowers> all   # e2e réel claude -p : COÛTE DES TOKENS, plusieurs minutes
claude --plugin-dir /srv/AdrienGras/superpowers-statusbar   # essai live avec rechargement à chaud
```

## Règles du projet

- **Texte affiché en anglais** (bande, pane, notifications, README). Ça vaut aussi pour les scripts de dev.
- **Anti-objectifs** :
  - ne jamais afficher une information fausse avec assurance : dans le doute, `?` ou rien ;
  - ne jamais modifier le comportement de superpowers ;
  - une session neuve n'adopte rien depuis le disque ; la reconstruction se fait depuis le transcript, et seulement sur `--resume`.
- **Pas de donnée client dans git.** Les fixtures sont synthétiques (`tests/fixtures/`, `e2e/fixture/`). Les vraies données vont dans `fixtures-local/` (gitignoré).
- **Couleurs** : uniquement des `ThemeKey` du thème Claude Code. `success` pour ce qui est fait, `warning` pour ce qui est en cours, texte par défaut pour ce qui n'a pas commencé, `subtle` pour le secondaire.
- **Détection superpowers** : une règle cassée se corrige dans `src/detectors/sp-7.0.0.ts`, avec un test dans `tests/detect.test.ts`, puis on relance `npm run contract`. Une nouvelle version de superpowers commence par le contrat statique, puis l'e2e.
- **Descriptions de dispatch** : les vraies sessions d'Adrien tournent avec un CLAUDE.md global en français. Les descriptions des subagents peuvent donc être en français, et les heuristiques doivent rester bilingues (ex. `/review|revue/i`, exclusion `/\bfix|correct|corrig/i`).

## E2E : ce qu'il faut savoir

- Lancé avec `--setting-sources project,local`, ce qui isole de la config utilisateur : le hook RTK global, le CLAUDE.md global et les plugins installés. Sans ça, le hook RTK réécrit `git`/`cat` en `rtk …` et les commandes sont refusées.
- `--permission-mode acceptEdits` plus une liste d'outils autorisés. **Ce n'est pas un bac à sable** : `node --test`, `npm test` et `git` exécutent du code. À lancer seulement sur une machine où c'est acceptable.
- `--model sonnet`. `claude -p` attend bien les subagents lancés en arrière-plan.
- En mode inline, le contrôleur n'appelle pas `report_phase`. C'est un avertissement et non un échec (ticket #3).
- Les traces sont copiées dans `fixtures-local/e2e/`.

## Workflow

- On travaille avec superpowers (brainstorming → writing-plans → subagent-driven-development).
- Chaque chantier se fait sur une branche dédiée, puis une PR vers `main`. Les tickets se ferment depuis la PR (`Closes #n`).
- Messages de commit en anglais, au format `type: sujet`.
