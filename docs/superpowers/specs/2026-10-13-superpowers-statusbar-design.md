# superpowers-statusbar — design

Date : 2026-10-13
Dépôt : https://github.com/AdrienGras/superpowers-statusbar (public)

Mise à jour en fin d'implémentation (v1) : ce document décrit ce qui a été construit. Les choix qui ont changé pendant l'implémentation sont marqués *(décidé pendant l'implémentation)*.

**Langue** *(décidé pendant l'implémentation, par Adrien après le test en direct)* : tout le texte que la personne voit (bande, pane, notifications, commande, README) est en anglais, le dépôt étant public. Le texte lu par le modèle (description de l'outil) l'est aussi. Ce document reste en français ; les libellés cités sont ceux de l'interface, en anglais.

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
- Reconstruire l'état depuis le transcript uniquement sur une session reprise (`--resume`, `--continue`) ; un run stocké survit au rechargement et à la compaction, comme le décrit la section Reconstruction. *(v0.1.1)*
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
⠋ exec SDD ▰▰▰▰▰▰▱▱▱▱▱▱▱▱▱ 7/15 · Task 7: Ledger parser · review · fix 2/5 · 42m
⠋ exec inline ▰▰▰▰▰▰▱▱▱▱▱▱▱▱▱ 7/15 · Task 7: Ledger parser · GREEN · 18m
```

Ordre : voyant, étape, barre et compteur, titre de la tâche, phase de la tâche, temps écoulé du run. Le compteur donne la position (tâches terminées, plus une si une tâche est en cours) ; la barre, les tâches terminées, arrondies vers le bas : elle n'est pleine qu'une fois toutes les tâches terminées.

Total inconnu *(décidé pendant l'implémentation)* : tant qu'aucun plan listant des tâches n'a été lu, les tâches connues sont seulement celles que les scripts ont démarrées ; le compteur s'écrit alors `<n>/?` et la barre disparaît, plutôt qu'un total inventé.

Voyant et couleurs *(décidé pendant l'implémentation, test en direct)* : le voyant est un spinner braille animé (`⠋⠙⠹…`, ~100 ms) là où la surface sait l'animer (terminal et desktop, via un élément `Client` qui tourne sur l'horloge de la surface, sans redessiner l'arbre du mod) ; ailleurs, ou si le `Client` échoue, un `●` fixe. Les couleurs sont celles du thème de Claude Code : `success` pour ce qui est fini, `warning` pour ce qui est en cours, texte par défaut pour ce qui n'a pas commencé, `subtle` pour l'information secondaire (durées, séparateurs, verdicts, étiquettes).

Phases d'une tâche :
- **SDD** : `brief` → `implementing` → `review` → `fix r/5` → `re-review r` → `done`.
- **Exécution directe** (`exec inline`) : `brief` → `RED` → `GREEN` → `refactor` → `verify` (le `task-done`) → `done`.

Avant l'exécution, la même ligne s'adapte : `● brainstorming · conversation`, `● brainstorming · builder check`, `● plan · drafting`, `● plan · 15 tasks`. *(v0.1.1)* Sous plan, la bande donne le nombre de tâches puis la phase rapportée (`● plan · 12 tasks · self-review`) ; la bande dit `self-review`, le pane garde `plan self-review`. Après : `● final review`, `● final review · fixes`, puis un état terminé avec un résumé : `✓ done · 15 tasks · 4 fix rounds · 2 set aside · 3h12`.

Quand le run attend Adrien, la ligne devient un seul bloc surligné (fond `warning`, texte `inverseText`, espaces compris), avec la raison ; en exécution, le compteur suit hors du bloc si la place le permet :

```
 WAITING · plan ready (15 tasks) · pick an execution mode
 WAITING · Task 7 blocked  · 7/15
```

Raisons attendues : question du brainstorming (`question for you`), validation de la spec (`review the spec`), choix du mode d'exécution, implémenteur bloqué, breaker des 5 fix rounds (`5 fix rounds used up`), menu de fin de branche (`ready for your test · finishing menu`), et sinon `your turn`.

Hors run superpowers, la bande n'affiche rien (le hook rend `next(e)`).

La bande se dimensionne sur `e.props.bodyColumns` : quand la place manque, elle retire d'abord le temps écoulé, puis le titre de la tâche, puis la barre (le compteur reste). En attente, la raison se coupe avec `…` dans le bloc. *(v0.1.1)* Toutes les bandes tiennent dans `bodyColumns` : brainstorming, plan, revue finale et fin de branche retirent d'abord le temps écoulé puis la phase ; en attente, sous la largeur du bloc (` WAITING · `), le bloc entier est coupé à la largeur, sans jamais la dépasser.

## Le pane latéral

Il raconte le run. Blocs retenus par Adrien, de haut en bas (titres `STAGES`, `TASKS`, `CURRENT TASK`, `DECISIONS & SET ASIDE`, `ESTIMATE`) ; un bloc vide n'est pas affiché :

1. **Étapes** : brainstorming, plan, exec, final review, finishing, done. Mise en page *(décidée pendant l'implémentation, test en direct)* : une ligne par étape, sa marque et son libellé dans la couleur de son état : `✓` finie, spinner pour l'étape en cours, `○` pas commencée, `–` sautée ; une étape finie porte sa durée alignée à droite. Les jalons de brainstorming et plan (spec written, builder check, spec awaiting approval, `N tasks · M steps`) s'affichent en sous-lignes `subtle`. Une étape derrière l'étape courante que le run n'a jamais traversée (ni jalon, ni heure d'entrée) est sautée, quelle que soit sa place : un run passé de l'exécution à la fin de branche sans revue finale montre la revue finale `–`, jamais `✓`.
2. **Tâches** : une ligne par tâche, mêmes marques et couleurs, titre, durée alignée à droite pour une tâche finie, nombre de fix rounds. Si la liste dépasse la hauteur, la tâche en cours et ses voisines restent visibles (au moins 3 lignes) et le reste se replie en `(+N)`.
3. **Tâche en cours** : ses phases en liste verticale, une par ligne : `✓` pour les phases passées avec leur verdict (`ok`, `needs fixes`, `open`…), le spinner pour la phase en cours, `○` pour les phases encore attendues (SDD : brief → implementing → review → done, les fix et re-review s'insèrent au fil de l'eau ; exécution directe : brief → RED → GREEN → refactor → verify → done).
4. **Décisions et points mis de côté** : rulings, minors différés, findings parkés, tirés du ledger. *(Décidé pendant l'implémentation)* : seules les dernières qui tiennent dans la hauteur restante s'affichent (au moins 3), les plus anciennes comptées en `(+N)` au-dessus ; ces lignes entrent dans le budget de hauteur pour que l'estimation reste visible.
5. **Estimation** : temps moyen par tâche terminée, temps restant, heure de fin probable (`avg 6m/task · ~48m left · ETA 17:40`). *(v0.1.1)* Pas d'estimation tant qu'aucun plan n'a été lu : sans plan, le nombre de tâches restantes est inconnu, donc le bloc n'est pas affiché.

Quand le run attend Adrien, rien ne tourne dans le pane : les marques « en cours » deviennent un `●` fixe en `warning` *(décidé pendant l'implémentation)*. Le temps écoulé et l'estimation avancent par une minuterie d'une minute tant qu'un run est en cours.

Ouverture *(mon choix)* :
- la commande `/sp-progress` ouvre et ferme le pane ;
- il s'ouvre aussi tout seul au démarrage de l'exécution, seulement là où il serait docké à côté du transcript (`e.viewport.isFullscreen` lu par la bande) ; ailleurs il attend la commande.
- *(v0.1.1)* Le moteur décide du placement : `$.ui.open` répond `isPlaced: false` quand le terminal est trop étroit (144 colonnes pour un pane non demandé, 110 une fois que la personne l'a demandé). Un pane non placé est refermé (`$.ui.close`) et n'est pas compté ouvert : `/sp-progress` répond `Progress pane cannot be shown here.` et le prochain appel retente l'ouverture au lieu de fermer. Si l'ouverture échoue, la commande répond `Progress pane unavailable.`. La bande ne retient `isFullscreen` que sur les surfaces où elle dessine (terminal, desktop).

La maquette de référence est dans `.superpowers/brainstorm/` (fichier `pane.html`), non versionnée ; la description ci-dessus fait foi.

## Notifications

Par le canal de notification habituel d'Adrien (`$.ui.notify`). L'API ne sait pas s'il regarde le terminal : on ne cherche pas à le deviner. Règle (décidée par Adrien) : une notification **à chaque fois** que le run passe en attente pour l'une de ces raisons, et pour aucune autre :

- plan prêt, choix du mode d'exécution ;
- implémenteur bloqué (`BLOCKED`) ou breaker des 5 fix rounds sauté ;
- revue finale terminée, menu de fin de branche prêt pour le test humain.

Les questions du brainstorming et la validation de la spec ne notifient pas. Le texte de la notification est celui de la raison d'attente (en anglais), sous le titre `superpowers`.

Une option du mod (`userConfig`) les coupe. Le mod ne touche pas à la notification générique de Claude Code (fin de tour) ; le README explique comment la couper si le doublon gêne.

## D'où viennent les informations

Superpowers 7.0.0 n'écrit en format fixe que la sortie de ses scripts et une partie du ledger ; le reste se lit dans les events. Le mod combine trois sources.

### 1. Les events Claude Code

| Event | Ce qu'on en tire |
|---|---|
| `tool.call` sur l'outil `Skill` *(décidé pendant l'implémentation)* | Entrée dans un skill de la chaîne (`superpowers:brainstorming`, `writing-plans`, `subagent-driven-development`, `executing-plans`, `finishing-a-development-branch`), compté avant l'appel lui-même ; un appel en erreur ne compte pas. C'est la source des skills appelés par le modèle ; les skills tapés en `/superpowers:…` viennent de `command.run` *(v0.1.1)*, voir la ligne suivante. Un skill vu dans un subagent (`agentId`) ne crée jamais de run et ne fait jamais reculer l'étape, même depuis `done` ; il la fait avancer, avec son mode, seulement si l'agent n'a pas de rôle reconnu (`implementer`, `reviewer`, `re-reviewer`, `final-reviewer`, `builder-check`) : un agent `other`, `unknown` ou inconnu du run peut le faire, ce qui couvre l'orchestrateur du mode « cheaper orchestration » qui appelle lui-même `subagent-driven-development` puis `finishing-a-development-branch`. Dans un subagent au rôle reconnu, il est ignoré *(v0.1.1)*. |
| `command.run` / `skill.prompt` *(v0.1.1)* | Un skill tapé en `/superpowers:…` est vu par `command.run` (sauf `sp-progress`), vérifié en live (`claude -p`, trace `via: command`). `skill.prompt` n'est plus observé : le plugin de sécurité intégré à Claude Code le contourne pour les plugins utilisateur et l'événement ne porte pas d'`agentId`, un skill de sous-agent pourrait donc démarrer un nouveau run à tort. Le mod n'écrit toujours rien dans le texte des skills. |
| `tool.call` (avec `await next(e)` pour lire le résultat) | Scripts Bash et leurs sorties, Write de la spec et du plan, dispatchs Agent (rôle du subagent par sa `description`, à défaut par la première ligne de son prompt), reprises `SendMessage` d'un agent connu. Porte `agentId` : on voit aussi ce qui se passe dans les subagents (mode orchestrateur compris). |
| `turn.start` / `turn.complete` (boucle principale) | La session rend la main : c'est le signal `WAITING`, la raison venant de l'étape en cours ; sauf si un agent lancé en arrière-plan travaille encore. Le tour suivant efface l'attente. `turn.complete` d'un subagent porte son rapport (statut, verdict). |
| `session.start` | Déclenche la reconstruction depuis le transcript (voir plus bas). |

`agent.spawn` *(v0.1.1)* est la source du **départ** de tous les dispatchs, synchrones ou en arrière-plan : le hook appelle `next(e)` pour obtenir l'`agentId`, puis observe un événement `spawn` (description, prompt, `parentAgentId`). Le rôle se déduit comme avant (`roleOf`) et l'agent est en cours dès son départ. Les spawns de workflows (`workflow`) et de teammates (`isTeammate`) sont ignorés. Le `tool.call` `Agent` ne sert plus qu'à rapporter la réponse d'un dispatch synchrone (`status: completed`) et de **repli** quand l'`agentId` n'a pas été vu au spawn (reconstruction sur `--resume`, dont le transcript ne contient pas de spawn, ou spawn que le moteur n'a pas montré) : il dispatche alors comme avant. Un dispatch n'est jamais compté deux fois. Chaque ligne de trace porte `via`, le type d'événement observé qui a produit l'action.

Marqueurs utilisés (superpowers 7.0.0) :

| Marqueur | Signification |
|---|---|
| Write vers `docs/superpowers/specs/*-design.md` | spec écrite |
| Write vers `docs/superpowers/plans/*.md` | plan écrit ; on le parse |
| Bash `sdd-workspace PLAN` → ligne de sortie finissant par `/.superpowers/sdd/<nom>` | début de l'exécution, emplacement du workspace ; le plan est relu. Un chemin de plan relatif se lit depuis la racine du dépôt où vit le workspace (le chemin du workspace moins `/.superpowers/sdd/<nom>`), pas depuis le dossier de la session, qui diffère dans un worktree *(décidé pendant l'implémentation)*. Le plan est le premier argument qui ne commence pas par `-`. Appelé après un run `done`, il ouvre un nouveau run en exécution : `done` compte comme pas de run *(v0.1.1)* |
| Bash `task-brief PLAN N` → `wrote …/task-N-brief.md: L lines` | SDD : début de la tâche N |
| Agent `Implement Task N: …` | SDD : écriture |
| Agent `Review Task N (spec + quality)` | SDD : relecture |
| SendMessage vers l'implémenteur enregistré, ou Agent sans description de modèle après une relecture | SDD : fix round (1 à 3 en reprise, 4 et 5 en nouvel agent) |
| Agent `Re-review Task N fix round R` | SDD : re-review du round R |
| Agent `Review code changes` (ou prompt `You are a Senior Code Reviewer`) en exécution ; à défaut, tout dispatch dont la description contient le mot `review` ou `revue` (pas collé à une lettre : `Preview` n'en est pas un) une fois le plan lu et toutes ses tâches terminées, hors corrections (`fix`, `correct`, `corrig`) *(décidé pendant l'implémentation ; v0.1.1 pour le mot entier et le plan lu)* | revue finale |
| Bash `task-start PLAN N` → `brief:` / `base:` | exécution directe : début de la tâche N |
| Bash `task-done PLAN N BASE -- cmd` → `ledger: Task N: complete …` ou `NOT recorded` | exécution directe : fin (ou échec) de la tâche N |
| Résultat d'implémenteur `**Status:** BLOCKED` | attente : implémenteur bloqué |
| Rapport de relecteur : la ligne `**Task quality:**` fait foi ; un `❌` ne compte que si elle manque *(décidé pendant l'implémentation)* | relecture propre ou à corriger |
| `rm` récursif (`-r`, `-R`, `-rf`, `-fr`, `--recursive`, avec ou sans `--`) d'un seul chemin qui est le workspace du run : chemin complet, chemin relatif contenant `.superpowers/sdd/` dont le workspace est le suffixe, ou `$VAR` / `${VAR}` assignée à ce workspace plus tôt dans la même commande ; sans workspace connu, rien *(v0.1.1)* | workspace supprimé, fin de l'exécution |
| Skill `finishing-a-development-branch` | fin de branche ; son menu = attente |
| En fin de branche : Bash `git merge`, `git push`, `gh pr create` ou `git branch -D` | run terminé (fusion, PR ou abandon) |
| En fin de branche : un tour qui répond au menu *(décidé pendant l'implémentation, révisé v0.1.1)* | *(v0.1.1)* le run ne se termine que sur merge, push, PR, suppression de branche (`git branch -D`) ou le rapport de garde (`Keeping branch <name>.` / « Je garde la branche… » / « Branche … conservée »). Toute autre réponse (confirmation de `discard`, correction…) laisse le run ouvert, en attente `your turn` (`other`), sans nouvelle notification |

### 2. L'instrumentation (choix validé par Adrien)

Là où superpowers ne laisse aucune trace (phases du brainstorming, rédaction du plan, cycle TDD), le mod la crée :

- il enregistre un outil `report_phase` (`$.tool.register`, `isDeferred: false` : toujours présent dans la liste d'outils, subagents compris, sans aller-retour ToolSearch), servi par son propre hook `tool.call` qui répond un texte court ;
- *(décidé pendant l'implémentation)* les consignes de signalement vivent dans la **description de l'outil** : « pendant `brainstorming`, `writing-plans` ou `test-driven-development`, appelle `report_phase` à chaque entrée dans l'une de ces phases ». Le design prévoyait qu'un hook `skill.prompt` ajoute cette section au texte des skills ; le plugin de sécurité intégré à Claude Code contourne ce hook pour les plugins installés au niveau utilisateur, et le mod n'écrit donc plus rien dans les skills (`skill.prompt` n'est plus observé *(v0.1.1)*). Coût : quelques centaines de tokens de description d'outil à chaque requête ;
- les valeurs sont fixées par le mod : brainstorming (`conversation`, `design-writing`, `builder-check`, `awaiting-approval`), plan (`drafting`, `self-review`), TDD (`red`, `green`, `refactor`). Le dispatch d'un subagent builder check pendant le brainstorming vaut aussi la phase `builder-check`.

La description ne change aucune consigne d'un skill ; elle demande seulement de signaler. Si le modèle oublie un signalement, l'affichage garde la phase précédente ou montre `?` ; il n'invente rien. Constaté en e2e : en exécution directe, le contrôleur signale rarement RED/GREEN lui-même ; les implémenteurs SDD le font.
- *(v0.1.1)* Exécution directe (#3) : la description de l'outil demande aussi explicitement le signalement quand le modèle exécute lui-même un plan : « This includes executing a plan yourself (superpowers' executing-plans): report red, green and refactor for each task as you go, as an implementer subagent does. » La description reste sous 1500 caractères, et l'ensemble des phases acceptées par le détecteur dérive de la même liste (`ALL_PHASES`, #11).
- *(#3)* Deuxième source pour les consignes et pour RED/GREEN, voir `2026-10-14-tdd-phases-design.md`. Piste B : une consigne courte (environ 300 tokens) est injectée au démarrage de la session et de chaque subagent par des hooks classiques `SessionStart` et `SubagentStart` déclarés dans `hooks/hooks.json` (`additionalContext`), car `prompt.*` n'est jamais appelé pour un mod utilisateur ; la description de l'outil garde ses consignes. Piste A : le détecteur déduit RED et GREEN des commandes de lancement du plan (`parsePlan` les liste par tâche) pour la boucle principale en exécution directe ou un implémenteur : la première écriture d'un fichier de travail dans un segment donne `red`, le premier lancement d'une commande du plan après une écriture donne `green`. Il ne dit jamais que les tests passent ou échouent, ne déduit jamais `refactor`, et ignore les appels refusés et les relecteurs.
- *(v0.1.1)* Routage des phases TDD : un `red`, `green` ou `refactor` signalé par un agent enregistré comme `implementer` va à sa tâche ; par un agent d'un autre rôle reconnu (relecteur, etc.), il est ignoré ; par un agent `other`, `unknown` ou inconnu, ou par la boucle principale, il va à la tâche courante. La tâche courante est la tâche active activée en dernier (`activeAt` : dernier lancement de son implémenteur ou de son script), puis la dernière activité de sa trace. Le jalon « N tasks · M steps » est identifié par son `kind: 'plan-count'` et remplacé à chaque rechargement du plan ; le verdict d'un re-reviewer en retard va à l'événement `re-review` de son round.

### 3. Le disque

- **Le plan** (`docs/superpowers/plans/…md`, ou le chemin réellement écrit) : nombre de tâches, titres, nombre d'étapes. Tâches : titres `^#+[ \t]+Task[ \t]+[0-9]+` hors blocs de code (`##` et `###` coexistent ; des tâches suffixées `3a` existent). Étapes : `- [ ] **Step N:` dans l'étendue d'une tâche. Les cases ne sont jamais cochées par superpowers : la progression ne vient pas du plan.
- **Le workspace** `<git toplevel>/.superpowers/sdd/<slug>/` : marqueur `plan-path` (identifie le plan propriétaire ; collisions en `<slug>-<parent>[-n]`), `progress.md` (ledger), `task-N-brief.md`, `task-N-report.md`, `review-B..H.diff`, `task-N-tests.log`. L'ancien chemin plat `.superpowers/sdd/progress.md` est ignoré.
- **Le ledger** `progress.md` : seules certaines lignes sont stables (`Task N: complete (…)`, `Task N: fix round R/5 (…)`, `Task N: minor (deferred): …`, `Task N: parked — …`, `Ruling: …`, en-tête `# SDD ledger — plan: …`). Le reste est rédigé librement par le modèle, souvent en français, et doit être ignoré sans erreur. Le parseur tolère tiret long ou court et des SHA de longueur variable.

Le suivi en direct vient des events. Pas de surveillance de fichiers dans l'API : relecture sur event (le plan à `sdd-workspace`, le ledger quand un outil touche `progress.md`) ; la minuterie d'une minute (`$.clock.every`) ne fait que redessiner tant qu'un run est actif *(précisé pendant l'implémentation)*.

### Reconstruction : quel run adopter (décidé par Adrien)

Des workspaces de runs terminés traînent sur le disque (plus de dix sous `/srv`), et plusieurs sessions peuvent tourner en parallèle dans le même dépôt. Un workspace présent ne prouve donc pas qu'un run est en cours. Règle :

- **Une session fraîche démarre vide.** Elle n'adopte jamais un workspace trouvé sur le disque.
- Un run déjà stocké dans `$.state` (rechargement du mod, compaction) est gardé tel quel. On reconstruit **seulement** quand une session démarre avec un transcript et sans run stocké : une session reprise (`--resume`, `--continue`).
- On ne reconstruit **que le run que le transcript de cette session mentionne** (`$.session.messages()` : appels `Skill`, Write de la spec et du plan, appels aux scripts avec le chemin du plan). Le plan et le ledger sur disque ne sont lus que pour ce run-là, au chemin que donne la sortie de `sdd-workspace` dans le transcript.
- Le transcript permet aussi de reconstruire les étapes brainstorming et plan, que le disque ne connaît pas. La reconstruction rejoue les mêmes détecteurs que le direct, en silence (ni notification, ni trace, ni ouverture du pane), avec des heures inconnues.
- *(Décidé pendant l'implémentation)* À la fin de la reconstruction, aucun agent n'est plus « en cours » : les agents lancés en arrière-plan finissent par des notifications de tâche que le transcript ne rejoue pas comme fins de tour, et aucun ne survit à la session qui l'a lancé. Sans cela, le run ne passerait plus jamais en attente.

## Architecture *(mon choix)*

```
events (tool.call, command.run, turn.*, session.start) ──────┐
disque (plan, progress.md)  ──────────────────────────────────┼─► détecteurs → actions normalisées
                                                               │
                                                               ▼
                                          reducer pur → RunState dans $.state
                                                               │
                                       ┌───────────────────────┼──────────────────┐
                                  AbovePrompt (bande)     Pane (récit)     notifications
```

- **Détecteurs** : une table de règles par version de superpowers (`src/detectors/sp-7.0.0.ts`), chacune transformant un event en actions normalisées (`task-started`, `agent-dispatched`, `turn-ended`, `branch-finished`…) et en lectures de fichiers à faire (plan, ledger). Une montée de version ne touche qu'une table ; ses marqueurs (`MARKERS`) alimentent le contrat statique.
- **Reducer** : fonction pure `(RunState, Action) → RunState`, sans `$`, testable seule.
- **État** : `RunState` dans `$.state` (survit aux rechargements du mod), déclaré dans le contrat `types/index.d.ts`. La reconstruction depuis le transcript produit les mêmes actions que le direct.
- **Contraintes du moteur** *(constatées pendant l'implémentation)* : `$` ne passe pas d'un fichier à l'autre (les helpers reçoivent un `EnginePort` construit dans `hooks/register.tsx`), et `read`/`update` n'acceptent qu'un atom déclaré dans le fichier qui l'utilise.
- **Rendu** : la bande et le pane lisent `RunState` ; ils ne calculent rien d'autre que la mise en page.
- **Un run par session** : une nouvelle entrée dans `brainstorming` ou `writing-plans` alors qu'un run est terminé démarre un nouveau run.

## Fabrication *(mon choix)*

- Mod Claude Code en TypeScript, API des hooks de fonctions (build 2.1.296 au moment du design ; l'API est en accès anticipé, le fichier de déclarations fait foi).
- La racine du dépôt est le mod : `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `hooks/hooks.json`, `hooks/register.tsx`, `types/index.d.ts`. Installation : `/plugin install superpowers-statusbar --marketplace AdrienGras/superpowers-statusbar`.
- Développement : `claude --plugin-dir /srv/AdrienGras/superpowers-statusbar` (rechargement à chaud).
- Surface : terminal et desktop, mêmes éléments ; le spinner y passe par un `Client` (`hooks/spinner.tsx`), avec repli sur un `●` fixe. La bande rend `next(e)` sur les autres surfaces ; le pane s'y dessine avec des marques fixes.
- Couleurs : uniquement les clés du thème de Claude Code (`success`, `warning`, `subtle`, `inverseText`), jamais de couleur codée en dur *(décidé pendant l'implémentation, test en direct)*.
- Version de superpowers ciblée : 7.0.0.

## Tests

1. **Contrat statique** : un script lit une version de superpowers (un chemin vers son dossier) et vérifie que chaque marqueur dont dépendent les détecteurs existe toujours : noms et sorties des scripts, modèles de ligne du ledger, descriptions de dispatch, format des titres de tâche du modèle de plan, noms des skills. Il dit quel détecteur est touché.
2. **Rejeu** : des séquences d'events rejouées dans détecteurs + reducer, avec l'état attendu.

   **Fixtures (décidé par Adrien)** : le dépôt est public et les vrais ledgers et transcripts viennent de projets clients. Le dépôt ne contient donc **que des fixtures synthétiques**, écrites à la main en reproduisant les formats réels (y compris les lignes libres en français, les tirets courts et longs, les SHA de longueurs variables). Les vrais ledgers, transcripts et traces e2e restent sur la machine d'Adrien, dans un dossier gitignoré (`fixtures-local/`), et alimentent des tests locaux en plus, sautés quand le dossier est absent.
3. **E2E local** : une commande (`npm run e2e -- <dossier superpowers> [sdd|direct|all]`) lance `claude -p` avec le mod et la version de superpowers à valider (`--plugin-dir` vers les deux) sur un mini dépôt de fixture contenant une spec et un plan de 3 tâches déjà approuvés, une fois en SDD, une fois en exécution directe. En mode e2e, le mod écrit sa trace d'états dans un fichier (`SP_STATUSBAR_TRACE`). Le test vérifie la séquence : exec puis revue finale, 3 tâches terminées, chacune passée par ses phases (relecture en SDD, vérification en direct), et, si le run a atteint la fin de branche, l'attente sur son menu en dernier. Des avertissements, qui décrivent le chemin choisi par le modèle sans faire échouer le test : pas de RED puis GREEN en direct, fin de branche jamais atteinte, et, en SDD, aucun dispatch vu à `agent.spawn` (seulement le repli `tool.call`) *(v0.1.1)*. Le brainstorming n'est pas joué (il demande un humain). Le modèle étant non déterministe, on vérifie l'ordre des étapes, pas leur nombre exact. Chaque run e2e fournit une trace de plus au niveau 2, rangée dans `fixtures-local/` (le dépôt de fixture est synthétique, mais la trace reste locale par défaut).

   *Isolation (décidée pendant l'implémentation)* : le run s'isole de la configuration personnelle avec `--setting-sources project,local` (ni hooks, ni plugins installés, ni `CLAUDE.md` utilisateur ; l'authentification reste), et seuls le mod et la version testée sont chargés. Pas de `bypassPermissions` : `acceptEdits` et une liste d'outils limitée (lecture, skills, subagents, l'outil du mod, les scripts de la version testée, `node --test`, `git`, `npm test`, la suppression du workspace du plan). Cette liste **n'est pas une frontière de sécurité** : `npm test` et `node --test` exécutent du code écrit par le modèle, `git` peut agir sur d'autres dépôts et lancer des commandes par alias. Elle guide un modèle coopératif ; le run est à traiter comme non isolé du système (pas de bac à sable), à lancer seulement sur une machine où c'est acceptable.
4. **Affichage** : bande et pane montés via le kit de test des mods (`claude plugin test`) sur des `RunState` types, sur terminal et desktop (marques, couleurs du thème, spinner, repli fixe).

## Risques connus

- Ledger rédigé à la main en SDD : dérive de format probable. On ne lit que les lignes stables.
- `review-package` ne dit pas quel type de revue il prépare ; le mod ne s'en sert pas, c'est le dispatch qui tranche.
- Fix rounds 1 à 3 : reprise par `SendMessage`, pas de nouvel `Agent`.
- Dispatchs groupés (plusieurs tâches d'un coup) et tâches scindées après un `BLOCKED` : le nombre de tâches peut changer en cours de route.
- Workspace supprimé en fin de run, ou par `git clean -fdx` ; worktree : le workspace vit dans le worktree, pas forcément dans le dossier de démarrage de la session (d'où la lecture du plan relatif depuis la racine du workspace).
- Skills lancés à l'intérieur d'un subagent (TDD dans un implémenteur) : visibles via `agentId` ; ils ne déplacent pas le run (règle de la table ci-dessus, *v0.1.1*), et les phases TDD vont à la tâche de l'implémenteur.
- API des mods en accès anticipé : elle bouge entre les versions de Claude Code.

## Plus tard

- v1.1 : systematic-debugging (phases par instrumentation, compteur de tentatives de fix, alerte à partir de 3).
- E2E automatique : workflow GitHub planifié qui interroge les releases d'obra/superpowers et lance l'e2e sur chaque nouvelle version (on ne peut pas recevoir directement les events d'un dépôt tiers).
