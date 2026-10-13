# superpowers-statusbar — design

Date : 2026-10-13
Dépôt : https://github.com/AdrienGras/superpowers-statusbar (public)

## Pourquoi

Adrien pilote plusieurs sessions Claude Code en parallèle et passe de l'une à l'autre. Il suit le brainstorming et le plan en direct, puis laisse l'exécution tourner et revient à la fin pour un test humain. Aujourd'hui, en revenant sur une session, il ne sait pas où en est le run : « il y a 15 tâches et tu ne sais pas où tu en es ».

Il a besoin de deux réponses d'un coup d'œil, dans cet ordre :

1. Est-ce que la session m'attend, ou est-ce qu'elle tourne ?
2. Où en est le run : quelle étape, quelle tâche sur combien, quelle phase de la tâche ?

## Ce que c'est

Un mod Claude Code (plugin de hooks de fonctions, API `claude-code`) qui observe un run [superpowers](https://github.com/obra/superpowers) et l'affiche de trois façons :

- **une bande** d'une ligne au-dessus du prompt (coup d'œil) ;
- **un pane latéral** qui raconte le run (retour sur la session) ;
- **des notifications système** quand le run se met à attendre Adrien pendant qu'il est ailleurs.

Le mod est en lecture seule : il ne pilote rien.

## Objectifs (v1)

- Suivre un run complet : brainstorming → plan → exécution (SDD ou exécution directe avec TDD) → revue finale → fin de branche.
- Afficher la bande, le pane et les notifications décrits plus bas.
- Reconstruire l'état après un démarrage de session, une compaction ou un rechargement du mod.
- Se tester sur trois niveaux, dont un e2e local relançable à chaque nouvelle version de superpowers.

## Non-objectifs (v1)

- **systematic-debugging** : prévu en v1.1 (ses 4 phases ne laissent aucune trace ; il passera par la même instrumentation).
- E2E automatique en CI sur les releases d'obra/superpowers : plus tard (voir « Plus tard »).
- Piloter le run (pause, relance, boutons d'action).
- Supporter d'autres harnais que Claude Code, ou des versions de superpowers antérieures à 7.0.0.
- Bloc « fichiers et contexte » dans le pane (spec, plan, branche, worktree) : écarté par Adrien.

## Anti-objectifs

- **Ralentir un run ou changer ce que superpowers produit.** L'instrumentation ajoute des signalements de phase, jamais de consigne qui modifie le travail.
- **Afficher une information fausse avec assurance.** Quand le mod ne sait pas, il affiche `?` plutôt qu'une phase inventée. Une bande fausse est pire qu'une bande absente.
- **Coûter des tokens visibles.** Un appel d'outil court par changement de phase, pas plus.

## La bande (au-dessus du prompt)

Format choisi par Adrien : **une seule ligne, centrée sur ce qui se passe maintenant** (option A des maquettes).

Quand le run tourne :

```
● exec SDD ▰▰▰▰▰▰▱▱▱▱▱▱▱▱▱ 7/15 · Task 7 « Parser du ledger » · relecture · fix 2/5 · 42 min
● exec direct ▰▰▰▰▰▰▱▱▱▱▱▱▱▱▱ 7/15 · Task 7 « Parser du ledger » · GREEN · 18 min
```

Ordre : voyant, étape, barre et compteur, titre de la tâche, phase de la tâche, temps écoulé du run.

Phases d'une tâche :
- **SDD** : écriture → relecture → fix r/5 → re-review → terminée.
- **Exécution directe** : RED → GREEN → refactor → vérif (le `task-done`) → terminée.

Avant l'exécution, la même ligne s'adapte : `● brainsto · conversation`, `● brainsto · spec en relecture`, `● plan · rédaction`, `● plan · 15 tâches`. Après : `● revue finale`, `● revue finale · corrections`, puis un état terminé avec un résumé (tâches, fix rounds, points mis de côté).

Quand le run attend Adrien, un badge `T'ATTEND` passe en tête avec la raison :

```
T'ATTEND plan prêt (15 tâches) · choisis le mode d'exécution
```

Raisons attendues : question du brainstorming, validation de la spec, choix du mode d'exécution, implémenteur bloqué, breaker des 5 fix rounds, menu de fin de branche.

Hors run superpowers, la bande n'affiche rien (le hook rend `next(e)`).

La bande se dimensionne sur `e.props.bodyColumns` : quand la place manque, elle retire d'abord le temps écoulé, puis le titre de la tâche, puis la barre (le compteur reste).

## Le pane latéral

Il raconte le run. Blocs retenus par Adrien, de haut en bas :

1. **Étapes** : brainsto, plan, exec, revue finale, fin de branche, chacune avec ses jalons (spec écrite, builder check, nombre de tâches et d'étapes du plan…).
2. **Tâches** : une ligne par tâche, avec statut, titre, durée, nombre de fix rounds. Si la liste dépasse la hauteur, la tâche en cours et ses voisines restent visibles et le reste se replie en `(+N)`.
3. **Tâche en cours** : le fil de ses phases avec les verdicts (`DONE`, `2 Important`, `1 ouvert`…). En exécution directe : RED → GREEN → refactor → vérif.
4. **Décisions et points mis de côté** : rulings, minors différés, findings parkés, tirés du ledger.
5. **Estimation** : temps moyen par tâche terminée, temps restant, heure de fin probable.

Ouverture *(mon choix)* :
- la commande `/sp-progress` ouvre et ferme le pane ;
- il s'ouvre aussi tout seul au démarrage de l'exécution, seulement là où il serait docké à côté du transcript (`e.viewport.isFullscreen`, largeur suffisante) ; ailleurs il attend la commande.

La maquette de référence est dans `.superpowers/brainstorm/` (fichier `pane.html`), non versionnée ; la description ci-dessus fait foi.

## Notifications

Par le canal de notification habituel d'Adrien (`$.ui.notify`). L'API ne sait pas s'il regarde le terminal : on ne cherche pas à le deviner. Règle (décidée par Adrien) : une notification **à chaque fois** que le run passe en attente pour l'une de ces raisons, et pour aucune autre :

- plan prêt, choix du mode d'exécution ;
- implémenteur bloqué (`BLOCKED`) ou breaker des 5 fix rounds sauté ;
- revue finale terminée, menu de fin de branche prêt pour le test humain.

Les questions du brainstorming et la validation de la spec ne notifient pas.

Une option du mod (`userConfig`) les coupe. Le mod ne touche pas à la notification générique de Claude Code (fin de tour) ; le README explique comment la couper si le doublon gêne.

## D'où viennent les informations

Superpowers 7.0.0 n'écrit en format fixe que la sortie de ses scripts et une partie du ledger ; le reste se lit dans les events. Le mod combine trois sources.

### 1. Les events Claude Code

| Event | Ce qu'on en tire |
|---|---|
| `skill.prompt` | Entrée dans un skill (`superpowers:brainstorming`, `writing-plans`, `subagent-driven-development`, `executing-plans`, `test-driven-development`, `requesting-code-review`, `finishing-a-development-branch`, `using-git-worktrees`). Se déclenche aussi pour un `/slash` tapé et un skill préchargé dans un subagent. |
| `tool.call` (avec `await next(e)` pour lire le résultat) | Scripts Bash et leurs sorties, Write de la spec et du plan, dispatchs Agent, reprises `SendMessage`, mises à jour de todos. Porte `agentId` : on voit aussi ce qui se passe dans les subagents (mode orchestrateur compris). |
| `agent.spawn` | Rôle du subagent par sa `description`. |
| `turn.complete` (boucle principale) | La session rend la main : c'est le signal « T'ATTEND », la raison venant de l'étape en cours. |
| `session.start`, `session.compact`, rechargement | Déclenchent la reconstruction depuis le disque. |

Marqueurs utilisés (superpowers 7.0.0) :

| Marqueur | Signification |
|---|---|
| Write vers `docs/superpowers/specs/*-design.md` | spec écrite |
| Write vers `docs/superpowers/plans/*.md` | plan écrit ; on le parse |
| Bash `sdd-workspace PLAN` → chemin absolu | début de l'exécution, emplacement du workspace |
| Bash `task-brief PLAN N` → `wrote …/task-N-brief.md: L lines` | SDD : début de la tâche N |
| Agent `Implement Task N: …` | SDD : écriture |
| Bash `review-package PLAN BASE HEAD` → `wrote …review-B..H.diff` | une revue se prépare (le type vient du dispatch qui suit) |
| Agent `Review Task N (spec + quality)` | SDD : relecture |
| SendMessage vers l'implémenteur enregistré, ou Agent sans description de modèle après une relecture | SDD : fix round (1 à 3 en reprise, 4 et 5 en nouvel agent) |
| Agent `Re-review Task N fix round R` | SDD : re-review du round R |
| Agent `Review code changes` après la dernière tâche | revue finale |
| Bash `task-start PLAN N` → `brief:` / `base:` | exécution directe : début de la tâche N |
| Bash `task-done PLAN N BASE -- cmd` → `ledger: Task N: complete …` ou `NOT recorded` | exécution directe : fin (ou échec) de la tâche N |
| Résultat d'implémenteur `**Status:** BLOCKED` | attente : implémenteur bloqué |
| `rm -rf …/.superpowers/sdd/<slug>` | workspace supprimé, fin de l'exécution |
| Skill `finishing-a-development-branch` | fin de branche ; son menu = attente |

### 2. L'instrumentation (choix validé par Adrien)

Là où superpowers ne laisse aucune trace (phases du brainstorming, rédaction du plan, cycle TDD), le mod la crée :

- il enregistre un outil `report_phase` (`$.tool.register`, `isDeferred: false` pour éviter un aller-retour ToolSearch), servi par son propre hook `tool.call` qui répond un texte court ;
- un hook `skill.prompt` ajoute à la fin du texte de `brainstorming`, `writing-plans` et `test-driven-development` une courte section : « appelle `report_phase` à chaque changement de phase, avec l'une de ces valeurs » ;
- les valeurs sont fixées par le mod : brainstorming (`conversation`, `design-writing`, `builder-check`, `awaiting-approval`), plan (`drafting`, `self-review`), TDD (`red`, `green`, `refactor`).

La section ajoutée ne change aucune consigne du skill ; elle demande seulement de signaler. Si le modèle oublie un signalement, l'affichage garde la phase précédente ou montre `?` ; il n'invente rien.

### 3. Le disque

- **Le plan** (`docs/superpowers/plans/…md`, ou le chemin réellement écrit) : nombre de tâches, titres, nombre d'étapes. Tâches : titres `^#+[ \t]+Task[ \t]+[0-9]+` hors blocs de code (`##` et `###` coexistent ; des tâches suffixées `3a` existent). Étapes : `- [ ] **Step N:` dans l'étendue d'une tâche. Les cases ne sont jamais cochées par superpowers : la progression ne vient pas du plan.
- **Le workspace** `<git toplevel>/.superpowers/sdd/<slug>/` : marqueur `plan-path` (identifie le plan propriétaire ; collisions en `<slug>-<parent>[-n]`), `progress.md` (ledger), `task-N-brief.md`, `task-N-report.md`, `review-B..H.diff`, `task-N-tests.log`. L'ancien chemin plat `.superpowers/sdd/progress.md` est ignoré.
- **Le ledger** `progress.md` : seules certaines lignes sont stables (`Task N: complete (…)`, `Task N: fix round R/5 (…)`, `Task N: minor (deferred): …`, `Task N: parked — …`, `Ruling: …`, en-tête `# SDD ledger — plan: …`). Le reste est rédigé librement par le modèle, souvent en français, et doit être ignoré sans erreur. Le parseur tolère tiret long ou court et des SHA de longueur variable.

Le suivi en direct vient des events. Pas de surveillance de fichiers dans l'API : relecture sur event, ou par minuterie (`$.clock.every`) tant qu'un run est actif.

### Reconstruction : quel run adopter (décidé par Adrien)

Des workspaces de runs terminés traînent sur le disque (plus de dix sous `/srv`), et plusieurs sessions peuvent tourner en parallèle dans le même dépôt. Un workspace présent ne prouve donc pas qu'un run est en cours. Règle :

- **Une session fraîche démarre vide.** Elle n'adopte jamais un workspace trouvé sur le disque.
- On reconstruit **seulement** après une compaction, un rechargement du mod ou une session reprise (`--resume`, `--continue`).
- On ne reconstruit **que le run que le transcript de cette session mentionne** (`$.session.messages()` : skills invoqués, Write de la spec et du plan, appels aux scripts avec le chemin du plan). Le workspace sur disque n'est lu que pour ce plan-là, retrouvé par son marqueur `plan-path`.
- Le transcript permet aussi de reconstruire les étapes brainsto et plan, que le disque ne connaît pas. La reconstruction rejoue les mêmes détecteurs que le direct.

## Architecture *(mon choix)*

```
events (skill.prompt, tool.call, agent.spawn, turn.complete) ─┐
disque (plan, progress.md, plan-path)  ───────────────────────┼─► détecteurs → actions normalisées
                                                               │
                                                               ▼
                                          reducer pur → RunState dans $.state
                                                               │
                                       ┌───────────────────────┼──────────────────┐
                                  AbovePrompt (bande)     Pane (récit)     notifications
```

- **Détecteurs** : une table de règles par version de superpowers (`detectors/sp-7.0.0.ts`), chacune transformant un event en action normalisée (`TaskStarted{n}`, `ReviewDispatched{n}`, `FixRound{n, r}`, `Waiting{reason}`…). Une montée de version ne touche qu'une table.
- **Reducer** : fonction pure `(RunState, Action) → RunState`, sans `$`, testable seule.
- **État** : `RunState` dans `$.state` (survit aux rechargements du mod), déclaré dans le contrat `types/index.d.ts`. La reconstruction depuis le disque produit les mêmes actions que le direct.
- **Rendu** : la bande et le pane lisent `RunState` ; ils ne calculent rien d'autre que la mise en page.
- **Un run par session** : une nouvelle entrée dans `brainstorming` ou `writing-plans` alors qu'un run est terminé démarre un nouveau run.

## Fabrication *(mon choix)*

- Mod Claude Code en TypeScript, API des hooks de fonctions (build 2.1.296 au moment du design ; l'API est en accès anticipé, le fichier de déclarations fait foi).
- La racine du dépôt est le mod : `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `hooks/hooks.json`, `hooks/register.tsx`, `types/index.d.ts`. Installation : `/plugin install superpowers-statusbar --marketplace AdrienGras/superpowers-statusbar`.
- Développement : `claude --plugin-dir /srv/AdrienGras/superpowers-statusbar` (rechargement à chaud).
- Surface : terminal d'abord. Le desktop vient sans effort si les mêmes éléments passent ; sinon le hook rend `next(e)` hors terminal.
- Version de superpowers ciblée : 7.0.0.

## Tests

1. **Contrat statique** : un script lit une version de superpowers (un chemin vers son dossier) et vérifie que chaque marqueur dont dépendent les détecteurs existe toujours : noms et sorties des scripts, modèles de ligne du ledger, descriptions de dispatch, format des titres de tâche du modèle de plan, noms des skills. Il dit quel détecteur est touché.
2. **Rejeu** : des séquences d'events rejouées dans détecteurs + reducer, avec l'état attendu.

   **Fixtures (décidé par Adrien)** : le dépôt est public et les vrais ledgers et transcripts viennent de projets clients. Le dépôt ne contient donc **que des fixtures synthétiques**, écrites à la main en reproduisant les formats réels (y compris les lignes libres en français, les tirets courts et longs, les SHA de longueurs variables). Les vrais ledgers, transcripts et traces e2e restent sur la machine d'Adrien, dans un dossier gitignoré (`fixtures-local/`), et alimentent des tests locaux en plus, sautés quand le dossier est absent.
3. **E2E local** : une commande lance `claude -p` avec le mod et la version de superpowers à valider (`--plugin-dir` vers les deux) sur un mini dépôt de fixture contenant une spec et un plan de 3 tâches déjà approuvés, une fois en SDD, une fois en exécution directe. En mode e2e, le mod écrit sa trace d'états dans un fichier. Le test vérifie la séquence : 3 tâches détectées, chacune passe par ses phases jusqu'à « terminée », revue finale, puis l'état « T'ATTEND » au menu de fin de branche. Le brainstorming n'est pas joué (il demande un humain). Le modèle étant non déterministe, on vérifie l'ordre des étapes, pas leur nombre exact. Chaque run e2e fournit une trace de plus au niveau 2, rangée dans `fixtures-local/` (le dépôt de fixture est synthétique, mais la trace reste locale par défaut).
4. **Affichage** : bande et pane montés via le kit de test des mods (`claude plugin test`) sur des `RunState` types.

## Risques connus

- Ledger rédigé à la main en SDD : dérive de format probable. On ne lit que les lignes stables.
- `review-package` ne dit pas quel type de revue il prépare ; c'est le dispatch suivant qui tranche.
- Fix rounds 1 à 3 : reprise par `SendMessage`, pas de nouvel `Agent`.
- Dispatchs groupés (plusieurs tâches d'un coup) et tâches scindées après un `BLOCKED` : le nombre de tâches peut changer en cours de route.
- Workspace supprimé en fin de run, ou par `git clean -fdx` ; worktree : le workspace vit dans le worktree, pas forcément dans le dossier de démarrage de la session.
- Skills lancés à l'intérieur d'un subagent (TDD dans un implémenteur) : visibles via `agentId`, à rattacher à la bonne tâche.
- API des mods en accès anticipé : elle bouge entre les versions de Claude Code.

## Plus tard

- v1.1 : systematic-debugging (phases par instrumentation, compteur de tentatives de fix, alerte à partir de 3).
- E2E automatique : workflow GitHub planifié qui interroge les releases d'obra/superpowers et lance l'e2e sur chaque nouvelle version (on ne peut pas recevoir directement les events d'un dépôt tiers).
