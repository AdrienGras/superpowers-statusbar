# superpowers-statusbar

Mod Claude Code qui affiche la progression d'un run [superpowers](https://github.com/obra/superpowers) : l'étape en cours (brainstorming, plan, exécution, revue finale, fin de branche), la tâche du plan, la boucle d'implémentation et de revue, et ce qui attend une réponse de votre part.

Superpowers 7.0.0 est requis : le mod reconnaît les scripts, les dispatchs de subagents et le ledger tels que cette version les écrit.

## Ce que fait le mod

- **Une bande au-dessus du prompt**, sur une ligne. Pendant l'exécution :

  ```
  ● exec SDD ▰▰▰▰▰▰▱▱▱▱▱▱▱▱▱ 7/15 · Task 7 « Parser du ledger » · relecture · fix 2/5 · 42 min
  ```

  Avant l'exécution, la ligne donne l'étape et sa phase (`● brainsto · conversation`, `● plan · rédaction`). Quand le run attend une réponse, un badge `T'ATTEND` passe en tête avec la raison. Quand la largeur manque, la bande retire d'abord le temps écoulé, puis le titre de la tâche, puis la barre. Hors run superpowers, la bande n'affiche rien.

- **Un pane** en cinq blocs : les étapes, les tâches (statut, durée, fix rounds), le fil de la tâche en cours, les décisions et points mis de côté tirés du ledger, et une estimation du temps restant. Un bloc vide n'est pas affiché.

- **Des notifications** quand le run passe en attente : plan prêt et choix du mode d'exécution, implémenteur bloqué ou breaker des 5 fix rounds, menu de fin de branche. Les questions du brainstorming et la validation de la spec ne notifient pas.

Le mod suit le run à partir des événements de Claude Code : les appels d'outils (scripts de superpowers, écritures de la spec et du plan, dispatchs de subagents) et leurs résultats, les fins de tour et les skills lancés par l'outil `Skill`. Pour les phases que ces événements ne montrent pas (conversation, rédaction et relecture de la spec ou du plan, RED/GREEN/refactor), le mod expose au modèle un outil, `report_phase`, dont la description lui demande de signaler chaque changement de phase pendant les skills `brainstorming`, `writing-plans` et `test-driven-development`. Le mod ne modifie pas le texte des skills.

Limite connue : un skill lancé en tapant `/superpowers:…` n'est vu qu'au travers du hook `skill.prompt`, que le plugin de sécurité intégré à Claude Code court-circuite pour les plugins installés au niveau utilisateur. Là où c'est le cas, ce lancement peut passer inaperçu ; le mod rattrape le run dès qu'un appel d'outil reconnaissable suit (par exemple le script `sdd-workspace` au début de l'exécution).

## Installation

Dans une session Claude Code, au prompt d'un terminal :

```
/plugin install superpowers-statusbar --marketplace AdrienGras/superpowers-statusbar
```

Répondez `y` pour ajouter le marketplace, puis choisissez le scope (utilisateur par défaut).

## Développement

Pour lancer une session avec le mod chargé depuis une copie locale du dépôt :

```
claude --plugin-dir /chemin/vers/superpowers-statusbar
```

Vérifications :

```
claude plugin test .
npx tsc -p .
claude plugin validate .
```

La variable d'environnement `SP_STATUSBAR_TRACE`, si elle nomme un fichier, y fait écrire une ligne JSON par action reconnue.

### Tests

- `claude plugin test .` : tests unitaires, sur des runs synthétiques (`tests/fixtures/`).
- `npm run contract -- <dossier superpowers>` : vérifie que les marqueurs que le mod reconnaît existent dans une version de superpowers.
- `npm run local` : passe les plans et ledgers réels déposés dans `fixtures-local/` (gitignoré) au parseur.
- `npm run e2e -- <dossier superpowers> [sdd|direct|all]` : e2e local avec un vrai `claude -p`. Le script copie `e2e/fixture` (une mini bibliothèque Node et son plan de 3 tâches) dans un dossier temporaire, y fait exécuter le plan en mode SDD (`subagent-driven-development`), en mode direct (`executing-plans`) ou les deux, avec le mod et la version de superpowers donnée chargés par `--plugin-dir`. Les superpowers installés sont désactivés le temps du run. Le run n'a pas toutes les permissions : `acceptEdits` et une liste d'outils limitée (lecture et écriture de fichiers, skills, subagents, l'outil du mod, les scripts de la version de superpowers testée, `node`, `git`, `npm test` et la suppression du workspace du plan) ; toute autre commande Bash est refusée. Il vérifie ensuite la trace du mod : étapes exec, revue finale et fin de branche dans l'ordre, les 3 tâches terminées, relecture de chaque tâche en SDD, vérification de chaque tâche et RED puis GREEN en direct, menu de fin de branche en dernier. Il affiche `E2E <mode> : OK` ou la liste des problèmes, et copie chaque trace dans `fixtures-local/e2e/`. Le run coûte des tokens (modèle `sonnet`) et prend plusieurs minutes par mode ; il demande `claude` et `jq`.

  ```
  npm run e2e -- ~/.claude/plugins/cache/superpowers-marketplace/superpowers/7.0.0 all
  ```

## `/sp-progress`

`/sp-progress` ouvre le pane, ou le ferme s'il est ouvert.

Le pane s'ouvre aussi tout seul au début de l'exécution du plan, mais seulement là où il se place à côté du transcript (terminal en plein écran). Ailleurs, il attend la commande.

## Option `notifications`

L'option `notifications` (activée par défaut) coupe les notifications du mod quand elle est désactivée. Elle se règle à l'installation.

Les notifications passent par votre canal habituel, celui que nomme le réglage `preferredNotifChannel` de Claude Code (`/config`, **Local notifications**).

## Couper la notification générique de Claude Code

Claude Code envoie sa propre notification quand une tâche se termine ou qu'une permission attend. Pendant un run, elle peut doubler celle du mod. D'après la documentation de Claude Code au moment de l'écriture :

- `preferredNotifChannel` réglé sur `"notifications_disabled"` coupe les notifications de Claude Code, **mais aussi celles du mod**, qui passent par le même canal. Si vous ne voulez garder que l'une des deux, gardez celles de Claude Code et désactivez l'option `notifications` du mod.
- Les hooks `Notification` de vos réglages s'exécutent en plus de la notification intégrée, sans la remplacer : ils ne permettent pas de la supprimer. Ils reçoivent aussi les notifications du mod (champ `plugin_notification`), ce qui permet, si vous notifiez par vos propres hooks, de traiter différemment celles du mod et celles de Claude Code (le matcher porte sur le type de notification, par exemple `idle_prompt` ou `permission_prompt`).
