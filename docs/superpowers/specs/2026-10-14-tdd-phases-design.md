# superpowers-statusbar : phases RED / GREEN fiables (#3)

Session « #3 », sur la branche `fix/3-tdd-phases`. Une PR vers `main` ferme #3. Le design de référence reste `2026-10-13-superpowers-statusbar-design.md` : il est mis à jour pour chaque décision ci-dessous qui le change, avec la marque *(#3)*. Ce document dit ce que la session change, pas ce qui existe déjà.

## Intention

Les phases RED / GREEN / refactor d'une tâche ne viennent aujourd'hui que du modèle, par l'outil `report_phase`, dont la description porte la consigne. Avec Sonnet, ça ne marche pas : un exécuteur inline ne l'appelle jamais, et en SDD un implementer sur deux seulement l'appelle. Tout le monde n'a pas Opus. Le but est que la bande et le pane montrent RED puis GREEN pour chaque tâche exécutée en TDD avec Sonnet, inline comme en SDD, sans jamais afficher une phase fausse.

Le critère de réussite : sur l'e2e réel avec Sonnet, chaque tâche terminée passe par `red` puis `green` dans sa trace, dans les deux modes et avec les deux fixtures (npm et bats, ci-dessous).

## Ce que le spike a établi (14/10, branche jetable `spike/3-tdd-phases`)

Mesures sur des runs `claude -p --model sonnet`, superpowers 7.0.0, plans de 3 tâches. Les données brutes sont dans `fixtures-local/spike3/` et dans les transcripts sous `~/.claude/projects/-tmp-sp-spike3-*`, gitignorés.

- **Le modèle fait le TDD mais ne le dit pas.** Dans les 5 e2e inline de la v0.1.1, Sonnet invoque `test-driven-development`, écrit le test, le voit échouer (« RED matches the plan's expected failure »), implémente et le voit passer. Il n'appelle `report_phase` dans aucun des 5. En SDD, 6 implementers sur 14 signalent, et aucun ne signale `refactor`. L'e2e affichait « OK » en SDD parce qu'un seul signalement par run suffisait.
- **Les hooks `prompt.compose`, `prompt.context`, `prompt.section` et `prompt.attachment` ne sont jamais appelés pour un mod utilisateur.** C'est vérifié par une écriture de fichier dans chacun, alors que celle de `session.start` passe. Même situation que `skill.prompt`.
- **Un hook `SessionStart` classique déclaré dans `hooks/hooks.json`, à côté de `modules`, fonctionne.** Son `additionalContext` arrive au modèle. `SubagentStart` arrive aussi dans les subagents (marqueur retrouvé dans leurs transcripts). C'est le mécanisme que superpowers utilise pour lui-même.
- **La consigne placée là (« piste B ») change le comportement de Sonnet.** En inline, sur 6 runs, `red` est signalé dans 15 tâches sur 18 et `green` dans 18 sur 18. En SDD, `red` est signalé par 7 implementers sur 7, `green` par 3 sur 7, plusieurs ayant été bloqués par les permissions du banc avant la fin. **Aucun signalement en avance ni en retard** : `red` arrive avant l'écriture du test, `green` juste après le run en échec, avant l'implémentation. Il reste des trous : un run sur six oublie `red` à chaque tâche.
- **Les commandes de run déclarées par le plan (« piste A ») permettent d'observer RED sans connaître l'outil de test.** Le gabarit `writing-plans` donne à chaque tâche « Run test to verify it fails / Run: `<commande>` / Expected: FAIL ». Rejouée sur 27 tâches (npm et bats), la séquence « écriture, puis run de la commande du plan » donne 22 RED réels observés et **0 faux**. A ne peut pas savoir si un run passe : le modèle tronque la sortie (`npm test 2>&1 | head -20`), ce qui masque le code de sortie. Son seul faux GREEN au rejeu venait de là, d'où la sémantique retenue ci-dessous.
- **Les vrais plans** (2 129 tâches dans 267 plans sur la machine d'Adrien, comptes agrégés seulement) : 75 % des tâches ont au moins une étape de run avec une commande, et 37 % une étape explicite « lancer, voir échouer ». Beaucoup sont rédigés en français (« Lancer le test, vérifier l'échec »).

## Objectifs

- **Piste B** : la consigne de signalement est placée dans le contexte de démarrage de la session et de chaque subagent.
- **Piste A** : le mod déduit `red` et `green` des écritures et des runs de la commande du plan, quand le modèle ne les a pas signalés.
- L'e2e exige `red` puis `green` sur chaque tâche terminée, dans les deux modes, avec une seconde fixture bats.
- Le README dit d'où viennent les phases et leurs limites.
- #3 est fermé par la PR, avec les chiffres du spike et ceux de l'e2e final.

## Non-objectifs

- `refactor` reste signalé par le modèle seul. A ne le déduit jamais.
- Les cycles RED→GREEN hors tâche (passe de corrections de la revue finale en inline) ne sont pas suivis.
- Pas de nouvel élément d'affichage. Les phases déduites s'affichent comme les phases signalées.
- #12, #13 et #14.

## Anti-objectifs (rappel du CLAUDE.md, ils priment)

- Ne jamais afficher une information fausse avec assurance. Dans le doute, rien.
- Ne jamais modifier le comportement ni le texte de superpowers. **Décision d'Adrien (14/10)** : une consigne statique au démarrage, au même titre que la description de l'outil, reste en deçà de la ligne. Un rappel injecté en cours de route, par exemple après un run de tests, la franchit et est exclu.
- Une session neuve n'adopte rien depuis le disque.

## Contraintes

Celles du moteur, dans `.claude/CLAUDE.md`, plus deux constatées par le spike et à y ajouter : les hooks `prompt.*` ne sont pas appelés pour un mod utilisateur, et les hooks classiques `SessionStart` / `SubagentStart` de `hooks/hooks.json` fonctionnent. Cœur `src/` pur, TypeScript effaçable. Textes affichés en anglais. Heuristiques bilingues.

Le mod est installé par des gens qui n'ont pas forcément `jq`, ni un Node capable d'exécuter du TypeScript. Le script des hooks classiques ne dépend que de ce que Claude Code garantit.

Vérifications de fin : `claude plugin test .`, `npm run typecheck`, `claude plugin validate .` sans avertissement, `npm run contract` vert, puis un e2e réel `all` sur les deux fixtures.

## Décisions

### Piste B : consigne au démarrage (décidée avec Adrien)

- `hooks/hooks.json` déclare, à côté de `modules`, un hook `SessionStart` et un hook `SubagentStart` de type `command`. Ils répondent `hookSpecificOutput.additionalContext` avec la consigne.
- **Le texte est celui mesuré au spike** (`spike/session-context.sh` du worktree `superpowers-statusbar-spike3`, sans le marqueur) *(mon choix : c'est le seul dont l'effet sur Sonnet est mesuré)*. Il ne parle que de TDD et nomme les deux cas qui comptaient : exécuter un plan soi-même avec `executing-plans`, et implémenter une tâche comme subagent. Il définit `red` comme « when you start writing a failing test » et `green` comme « when you start writing the code that makes it pass ».
  Le texte injecté au spike, marqueur retiré :

  > Status bar reporting (superpowers-statusbar plugin): whenever you follow superpowers test-driven-development, including when you execute a plan yourself with superpowers:executing-plans and when you implement a task as a subagent, call the mcp__superpowers-statusbar__report_phase tool each time you move into a TDD phase: red when you start writing a failing test, green when you start writing the code that makes it pass, refactor when you clean up with the tests green. It is a signal only; it changes nothing about how you work.
- La description de `report_phase` reste en place comme filet. Ses définitions de `red` et `green` s'alignent sur celles du texte de démarrage, pour que les deux ne se contredisent pas *(mon choix)*. Le reste de la description (brainstorming, writing-plans) ne change pas.
- Une seule source : le texte servi par le hook est généré depuis `src/instrument.ts`, et une vérification qu'ils sont identiques tourne dans `npm run typecheck` (`node scripts/gen-context.ts --check`) *(mon choix ; décidé pendant l'implémentation : le lanceur de tests du moteur ne peut pas lire de fichiers, donc ce n'est pas un test unitaire)*.
- Matcher de `SessionStart` : `startup|resume|clear|compact` *(mon choix : la consigne doit survivre à une compaction et à une reprise)*.
- Pas d'option pour la couper *(mon choix)*. Elle coûte environ 150 tokens (532 caractères) par session et par subagent, ce que le README dit.

### Piste A : phases déduites des commandes du plan (décidée avec Adrien)

**Ce que A affirme, et seulement ça :**
- `red` : l'agent a commencé à écrire dans la tâche (premier fichier de travail écrit) ;
- `green` : il a lancé une commande de run du plan après avoir écrit, il en est donc à l'implémentation.

A n'affirme jamais que des tests passent ou échouent. C'est la sémantique de B, mesurée au spike : `red` avant l'écriture du test, `green` après le run en échec.

**Commandes d'une tâche.** `parsePlan` relève, pour chaque tâche, les commandes de ses étapes de run :
- une ligne `Run:` suivie d'une commande entre backticks ;
- ses équivalents français (`Lancer :`, `Commande :`, `Exécuter :`) ;
- le contenu d'un bloc de code dans une étape dont le titre parle de lancer ou de vérifier (`run`, `verify`, `confirm`, `lancer`, `exécuter`, `vérifier`).

Les commandes `git` ne comptent pas, ni, *(revue finale)*, celles qui ne font que lire ou chercher (`cat`, `ls`, `grep`, `find`, `head`, `tail`, `wc`, `echo`, `printf`, `diff`, `test`, `[`, `jq`), les mots du shell relevés dans les blocs de script (`set`, `export`, `source`, `for`, `if`, `do`, `done`…) et les lignes réduites à un `cd`. Le programme regardé est celui du premier segment qui n'est pas un `cd`. Le repérage reste prudent : une tâche sans commande reconnue n'a pas de phase déduite. Le type `PlanTask` gagne cette liste.

**Reconnaître un run.** Une commande Bash exécutée correspond à une commande du plan quand l'un de ses segments correspond. Les segments sont séparés par `&&`, `||`, `;`, `|` ou un saut de ligne, et découpés en mots comme le fait le shell : une chaîne entre guillemets est un seul mot *(#18)*. La clé d'une commande du plan vient de son premier segment qui n'est pas un `cd`, sans les affectations `VAR=x` en tête, et s'arrête à sa première redirection *(revue finale)*. *(#18)* Elle garde les mots positionnels jusqu'au premier chemin passé en argument (un mot avec `/`, `.` ou `:` qui n'est pas le premier), prolongé des chemins qui le suivent directement (`vendor/bin/phpunit tests/X`), et n'en retient que les deux derniers : un préfixe (`rtk`, `rtk proxy`, `timeout 300`, `docker compose exec php`, `corepack`) ne fait jamais la clé à lui seul. Une clé sans chemin exige toutes les options de la commande du plan (`node --test`, `pytest -x`, `rtk proxy node --test`) *(revue finale, étendu par #18)*. *(#18)* Dans le segment exécuté, la clé peut commencer à n'importe quel mot, comparé par nom de base, ses autres mots suivant dans l'ordre, à l'identique ou comme fin de chemin ; jamais après un programme qui ne fait que lire (`git`, `cat`, `grep`, `echo`…). Le découpage ignore ce qui est entre guillemets, les corps de heredoc et les commentaires. Ainsi `npm --prefix /x test`, `cd /x; npm test 2>&1 | tail` et `bats test/text.bats` correspondent à `npm test` et à `bats test/text.bats --filter slugify`, `rtk proxy pnpm vitest run src/a.test.ts` à `pnpm vitest run src/a.test.ts`, `timeout 300 pnpm build` à `pnpm build` et `cargo test` à `rtk cargo test`, mais `rtk uv run ruff` ne correspond pas à `rtk uv run pytest tests/a.py`. Le mod voit la commande telle que le modèle l'a écrite : un hook `PreToolUse` qui la réécrit (RTK) passe sous les hooks `tool.call` des plugins *(#18)*. Restent ratés, volontairement : `pytest` contre un plan `rtk pytest` (la clé ne descend pas à un mot), `sh -c "…"`, `pnpm test` contre `pnpm vitest run`, et les sous-commandes propres à RTK (`rtk vitest`) *(#18)*.

**Reconnaître une écriture.** `Write`, `Edit`, `MultiEdit` ou `NotebookEdit` réussis, ou une redirection Bash (`>`, `>>`, `tee`) vers un fichier. Sont exclus les chemins sous `.superpowers/`, `docs/superpowers/`, `/dev/` et `.claude/`, et les fichiers `*.log`. *(Revue finale)* Une redirection n'est reconnue qu'en début de mot (`=>` n'en est pas une) et hors guillemets ; `tee` seulement comme commande d'un segment. Les redirections d'un pipeline (segments reliés par `|`) qui lance une commande du plan ne sont pas des écritures : elles ne font que garder la sortie du run, sinon un run de référence comme `npm test > /tmp/out.log` donnerait `red` et `green` d'un coup. `/tmp/` n'est pas exclu, les dépôts des fixtures e2e y vivent. Un appel Bash qui écrit puis lance compte comme écriture puis run.

**Ce qui ne compte jamais :**
- un appel qui n'a pas tourné, refusé par les permissions ou par les contrôles du shell (au spike : « Contains brace with quote character », « Permission to use Bash has been denied ») ;
- les appels aux scripts `task-start` / `task-done` de superpowers, qui relancent eux-mêmes les tests ;
- un run qui ne suit aucune écriture depuis le run précédent (run de référence, relance).

Attention : un test qui échoue sans tube rend le code de sortie 1, donc `isError` est aussi vrai pour un run qui a bien tourné. La distinction « refusé ou exécuté » est à établir en live (champ `deny` de `tool.call`, texte du refus). Le rejeu du spike utilisait « erreur dont la sortie ne ressemble à aucun résultat de test ».

**Qui est suivi :**
- en `direct`, les appels du fil principal (sans `agentId`) pendant qu'une tâche est active ;
- en `sdd`, les appels d'un agent de rôle `implementer`, rattachés à sa tâche.

Les reviewers lancent aussi les tests et ne comptent jamais.

**Segment.** Le suivi repart à zéro, avec un nouveau segment, à chaque activation de tâche en inline. En SDD, il repart à zéro à chaque implementer lancé et à chaque implementer repris par `SendMessage` (`agent-resumed`) *(mon choix)*. En 7.0.0, les rounds de fix 1 à 3 reprennent l'implementer d'origine et les rounds 4 et 5 en lancent un nouveau : chaque round de fix repasse ainsi par RED puis GREEN, quel que soit son numéro.

**Priorité entre A et B.** Une phase est posée au plus une fois par segment, et jamais à rebours : pas de `red` après un `green` dans le même segment.
- A n'ajoute une phase que si elle n'est pas déjà posée dans le segment.
- **Le cas courant pour `green`** : A pose `green` dès le `tool.call` du run en échec, et le modèle appelle `report_phase green` juste après. Le signalement de B ne crée pas de second événement, ce qui évite d'afficher « green » deux fois. Il change l'origine de l'événement existant en `reported`, qui garde l'heure de A, la plus précoce *(mon choix)*. Même chose pour un `red` de B qui arrive après la première écriture.
- Si B signale `green` sans `red`, A peut poser `red` à la première écriture, qui précède forcément.

Le modèle de données doit permettre ces contrôles : la trace des tâches ne garde aujourd'hui que la phase et l'heure.

**Trace.** Chaque événement de phase porte une origine, `reported` ou `observed`. L'affichage ne la distingue pas *(mon choix)*. Pour mesurer B, l'e2e compte les actions `phase-reported` de la trace, qu'elles aient ajouté un événement ou seulement confirmé celui de A. Il ne regarde pas l'origine finale des événements.

**Reprise.** Sur `--resume`, la reconstruction depuis le transcript rejoue les appels du fil principal, donc A en inline. Les appels des subagents ne sont pas dans ce transcript, donc A en SDD n'est pas reconstruit. C'est accepté.

### E2E

- `checkTrace` : dans les deux modes, chaque tâche terminée passe par `red` puis `green`, ce qui devient une **erreur** au lieu de l'avertissement actuel en inline. Un **avertissement** liste les tâches sans action `phase-reported` `red` ou `green` du modèle (B non suivi) *(mon choix : on garde une mesure de B sans faire échouer le run sur le comportement du modèle)*.
- Une seconde fixture `e2e/fixture-bats` (bibliothèque bash, tests bats, plan de 3 tâches au format du gabarit, commandes `bats test/text.bats --filter …` puis `bats test/text.bats`). C'est celle du spike, à reprendre. `scripts/e2e.sh` prend la fixture en paramètre (`npm`, `bats` ou les deux) et ajoute `bats` aux outils autorisés.
- Le stream de chaque run est copié dans `fixtures-local/e2e/` à côté de la trace *(mon choix : le spike a montré qu'il manquait pour comprendre un échec)*.
- Le banc du spike a été bloqué en SDD par la liste d'outils autorisés : les implementers enchaînent écriture et run dans un même appel (`cat >> … <<EOF … EOF && npm test`). Le builder élargit la liste au minimum nécessaire (lecture et écriture shell courantes) et le documente dans le commentaire du script, qui rappelle déjà que ce n'est pas un bac à sable.

### Contrat superpowers

`npm run contract` gagne les marqueurs du gabarit dont A dépend, dans `writing-plans/SKILL.md` : la ligne `Run: \``, `Expected: FAIL`, et l'étape « Run test to verify it fails ».

### Documentation

- **README**, section sur le fonctionnement : les phases TDD viennent d'abord du modèle, guidé par une consigne placée au démarrage de la session et des subagents. Le mod les complète à partir des commandes de run du plan. Limites, dites simplement :
  - une tâche dont le plan ne donne pas de commande de run n'a que les phases signalées par le modèle ;
  - le mod ne lit pas le résultat des tests ;
  - `refactor` dépend du modèle seul ;
  - la consigne coûte environ 150 tokens par session et par subagent.
- **Spec de référence** : la section qui parle de `report_phase` et de la description de l'outil est mise à jour *(#3)*.
- **`.claude/CLAUDE.md`**, « Contraintes du moteur » : hooks `prompt.*` non appelés pour un mod utilisateur, hooks classiques de `hooks.json` qui fonctionnent.

## Laissé au builder

- Le format exact de la marque d'origine dans le modèle et la trace, et la forme des nouvelles actions du reducer.
- Comment le script des hooks classiques produit son JSON sans `jq` (texte pré-encodé généré, par exemple), et la compatibilité Windows à la manière de `run-hook.cmd` de superpowers si elle est simple.
- La liste précise des formulations bilingues de titres d'étapes, dans l'esprit de « prudent : rater plutôt que se tromper ».
- Les fixtures de tests unitaires, synthétiques, dont un plan en français.
- Supprimer la branche et le worktree du spike une fois le design livré.
