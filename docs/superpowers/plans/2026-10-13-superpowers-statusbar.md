# superpowers-statusbar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un mod Claude Code qui suit un run superpowers 7.0.0 (brainstorm → plan → exec SDD/directe → revue finale → fin de branche) et l'affiche dans une bande au-dessus du prompt, un pane latéral et des notifications système.

**Architecture:** Un cœur pur dans `src/` (parseurs, détecteurs superpowers 7.0.0, reducer, vues) sans `$` ni API Node, testable par `claude plugin test` et importable par les scripts Node. Une couche mod dans `hooks/` qui normalise les events Claude Code en `ObservedEvent`, fait tourner détecteurs + reducer, range `RunState` dans `$.state`, dessine bande et pane, envoie les notifications. Des scripts Node dans `scripts/` pour le contrat statique, les fixtures locales et l'e2e.

**Tech Stack:** TypeScript (API des hooks de fonctions Claude Code 2.1.296, JSX via `h`), `claude plugin test` / `validate`, Node ≥ 23.6 (exécution native du TypeScript) pour les scripts, bash pour l'e2e.

**Spec:** `docs/superpowers/specs/2026-10-13-superpowers-statusbar-design.md`

## Global Constraints

- Nom du plugin : `superpowers-statusbar`, version `0.1.0`. Clé `$.state` : `superpowers-statusbar`. Outil : `report_phase`, exposé au modèle comme `mcp__superpowers-statusbar__report_phase`. Commande : `/sp-progress`.
- API : Claude Code 2.1.296, en accès anticipé. Le fichier de déclarations (`.claude-plugin/types/claude-code/index.d.ts`) fait foi sur ce plan en cas d'écart.
- Superpowers ciblé : 7.0.0 (`~/.claude/plugins/cache/superpowers-marketplace/superpowers/7.0.0`).
- `src/` : TypeScript effaçable uniquement (pas d'`enum`, de `namespace`, de propriétés de paramètre), imports relatifs avec l'extension `.ts`, imports de types en `import type`, aucune valeur importée de `'claude-code'`, aucun `$`, aucune API Node. Fonctions pures.
- `hooks/` et `src/` : pas d'`import()` dynamique, pas d'API Node (le module tourne sans DOM ni Node).
- Textes affichés à Adrien en français, exactement comme dans ce plan. Textes lus par le modèle (outil, instrumentation) en anglais.
- Anti-objectifs : ne jamais modifier une consigne d'un skill (on ajoute une section de signalement, rien d'autre) ; en cas de doute, afficher `?`, jamais une phase inventée.
- Une session fraîche démarre vide : aucun workspace du disque n'est adopté hors reconstruction depuis le transcript de la session.
- Le dépôt est public : aucune donnée réelle de projet client dans git. Fixtures synthétiques seulement ; données réelles dans `fixtures-local/` (gitignoré).
- Commandes de vérification : `claude plugin test .`, `claude plugin validate .`, `npx tsc -p .`.

## Review Focus

1. **Agents en arrière-plan** : le tour principal se termine pendant que des subagents tournent. Attendu : pas de `T'ATTEND`, la bande continue d'afficher la tâche. Test dans la Task 4.
2. **Agent synchrone** : le `turn.complete` du subagent arrive avant que l'appel `Agent` ait rendu son `agentId`. Attendu : le rapport est gardé et appliqué à l'enregistrement de l'agent. Test dans la Task 3.
3. **Plans réels** : `## Task` et `### Task` mélangés, tâches `3a`/`3b`, blocs de code à quatre backticks contenant des titres `### Task`. Attendu : seules les vraies tâches comptent. Test dans la Task 1.
4. **Ledgers rédigés à la main** : lignes libres en français, tiret court ou long, SHA de longueur variable, lignes dans un tableau markdown. Attendu : lignes reconnues parsées, le reste ignoré sans erreur. Test dans la Task 2.
5. **Terminal étroit** : à 30 colonnes, la bande garde le voyant, l'étape et le compteur. Test dans la Task 6.

---

### Task 1: Squelette du mod, contrat de types, parseur de plan

**Files:**
- Create: `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `hooks/hooks.json`, `hooks/register.tsx`, `types/index.d.ts`, `tsconfig.json`, `package.json`, `src/plan.ts`
- Modify: `.gitignore`
- Test: `tests/plan.test.ts`

**Interfaces:**
- Consumes: rien.
- Produces:
  - `types/index.d.ts` : tous les types du modèle ci-dessous, plus `declare module 'claude-code' { interface PluginState { 'superpowers-statusbar': { run: RunState | null } } }`.
  - `parsePlan(text: string): PlanTask[]` dans `src/plan.ts`.

Types à déclarer dans `types/index.d.ts` (exportés, utilisés par toutes les tâches) :

```ts
export type Stage = 'brainstorm' | 'plan' | 'exec' | 'final-review' | 'finishing' | 'done'
export type Mode = 'sdd' | 'direct'
export type ReportedPhase =
  | 'conversation' | 'design-writing' | 'builder-check' | 'awaiting-approval'
  | 'drafting' | 'self-review'
  | 'red' | 'green' | 'refactor'
export type TaskPhase =
  | 'brief' | 'writing' | 'review' | 'fix' | 're-review'
  | 'red' | 'green' | 'refactor' | 'verify' | 'done' | 'unknown'
export type ImplementerStatus = 'DONE' | 'DONE_WITH_CONCERNS' | 'BLOCKED' | 'NEEDS_CONTEXT'
export type PlanTask = { n: string; title: string; steps: number }
export type TaskEvent = { phase: TaskPhase; at: number; round?: number; verdict?: string }
export type TaskState = PlanTask & {
  status: 'todo' | 'active' | 'done'
  startedAt?: number; doneAt?: number
  fixRounds: number; trail: TaskEvent[]
  implementerId?: string; lastStatus?: ImplementerStatus; isBreakerTripped?: boolean
}
export type AgentRoleName = 'implementer' | 'reviewer' | 're-reviewer' | 'final-reviewer' | 'builder-check' | 'other' | 'unknown'
export type AgentRecord = { role: AgentRoleName; task?: string; round?: number; isRunning: boolean; pendingAnswer?: string }
export type WaitReason = 'brainstorm-question' | 'spec-approval' | 'execution-choice' | 'blocked' | 'breaker' | 'finishing-menu' | 'other'
export type Waiting = { reason: WaitReason; task?: string; since: number }
export type Decision = { kind: 'ruling' | 'minor' | 'parked'; task?: string; text: string }
export type Milestone = { stage: Stage; label: string; at: number }
export type FinalReview = { phase: 'review' | 'fixes' | 'done'; verdict?: string }
export type RunState = {
  id: string; startedAt: number; stage: Stage; stagePhase?: ReportedPhase
  mode?: Mode; specPath?: string; planPath?: string; workspace?: string
  tasks: TaskState[]; milestones: Milestone[]
  agents: Record<string, AgentRecord>
  waiting?: Waiting; decisions: Decision[]
  finalReview?: FinalReview; finishedAt?: number
}
export type LedgerLine =
  | { kind: 'complete'; task: string }
  | { kind: 'fix-round'; task: string; round: number }
  | { kind: 'minor'; task?: string; text: string }
  | { kind: 'parked'; task: string; text: string }
  | { kind: 'ruling'; task?: string; text: string }
export type ObservedEvent =
  | { kind: 'skill'; skill: string; at: number }
  | { kind: 'tool'; tool: string; input: Record<string, unknown>; text?: string; result?: unknown; isError?: boolean; agentId?: string; at: number }
  | { kind: 'turn-start'; at: number }
  | { kind: 'turn-end'; agentId?: string; answer: string; at: number }
  | { kind: 'file'; role: 'plan' | 'ledger'; path: string; text: string; at: number }
export type FileRequest = { role: 'plan' | 'ledger'; path: string }
export type Action =
  | { type: 'stage-entered'; stage: Stage; mode?: Mode; at: number }
  | { type: 'phase-reported'; phase: ReportedPhase; agentId?: string; at: number }
  | { type: 'spec-written'; path: string; at: number }
  | { type: 'plan-loaded'; path: string; tasks: PlanTask[]; at: number }
  | { type: 'workspace-found'; path: string; planPath: string; at: number }
  | { type: 'task-started'; task: string; at: number }
  | { type: 'agent-dispatched'; agentId: string; role: AgentRoleName; task?: string; round?: number; isRunning: boolean; at: number }
  | { type: 'agent-resumed'; agentId: string; at: number }
  | { type: 'agent-reported'; agentId: string; answer: string; at: number }
  | { type: 'task-verified'; task: string; isOk: boolean; at: number }
  | { type: 'ledger-loaded'; lines: LedgerLine[]; at: number }
  | { type: 'workspace-removed'; at: number }
  | { type: 'branch-finished'; at: number }
  | { type: 'turn-started'; at: number }
  | { type: 'turn-ended'; at: number }
export type Detection = { actions: Action[]; reads: FileRequest[] }
export type TraceEntry = { at: number; action: Action['type']; stage?: Stage; mode?: Mode; task?: string; phase?: TaskPhase; waiting?: WaitReason }
```

`at` vaut `0` pour un fait reconstruit dont l'heure est inconnue (Task 9) ; les vues traitent `0` comme « heure inconnue ».

- [ ] **Step 1: Poser le squelette**

  - `plugin.json` : `{ "name": "superpowers-statusbar", "version": "0.1.0", "description": "Live progress of a superpowers run: a band above the prompt, a side pane and notifications.", "types": "./types/index.d.ts", "userConfig": { "notifications": { "type": "boolean", "title": "Notifications", "description": "Notify when the run waits for you (plan ready, blocked task, finishing menu).", "default": true } } }`.
  - `marketplace.json` : `{ "name": "superpowers-statusbar", "owner": { "name": "Adrien Gras" }, "plugins": [{ "name": "superpowers-statusbar", "source": "./" }] }`.
  - `hooks/hooks.json` : `{ "modules": ["./register.tsx"] }`.
  - `hooks/register.tsx` : `export const register: Register = () => {}` (rempli en Task 7).
  - `tsconfig.json` : les `compilerOptions` de l'en-tête du fichier de déclarations (`target es2023`, `lib es2023`, `types []`, `module esnext`, `moduleResolution bundler`, `strict`, `noUncheckedIndexedAccess`, `noEmit`, `skipLibCheck`, `jsx react`, `jsxFactory h`, `jsxFragmentFactory Fragment`), plus `"allowImportingTsExtensions": true`. `include` : `[".claude-plugin/types", "hooks", "types", "tests", "src"]`.
  - `package.json` : `private`, `"type": "module"`, devDependencies `typescript` et `@types/node`, scripts `test: claude plugin test .`, `typecheck: tsc -p .`, `validate: claude plugin validate .`.
  - Si `.claude-plugin/types/claude-code/index.d.ts` est absent, y copier le fichier de déclarations écrit par le skill plugin-authoring (`/tmp/claude-1000/bundled-skills/2.1.296/<hash>/plugin-authoring/types/claude-code.d.ts`). Si ce fichier n'existe plus, recharger le skill plugin-authoring pour le régénérer. `.claude-plugin/types/` est déjà gitignoré.
  - `.gitignore` : ajouter `node_modules/` s'il manque.

- [ ] **Step 2: Écrire les tests qui échouent**

`tests/plan.test.ts`, avec `test` et `expect` de `claude-code/testing` :
  - `parsePlan reads ### Task headings with titles and step counts` : un plan avec `### Task 1: Modèle` (3 lignes `- [ ] **Step N: …**`) et `### Task 2: Repository` (2 étapes) → `[{ n: '1', title: 'Modèle', steps: 3 }, { n: '2', title: 'Repository', steps: 2 }]`.
  - `parsePlan mixes ## and ### headings and suffixed tasks` : `## Task 1: A`, `### Task 3a: B`, `### Task 3b: C` → `n` vaut `'1'`, `'3a'`, `'3b'`.
  - `parsePlan ignores headings inside fences, including four-backtick fences` : un bloc ```` ```` ```` markdown qui contient un bloc ```` ``` ```` et une ligne `### Task 9: Faux` → la tâche 9 n'apparaît pas, la tâche réelle qui suit le bloc est comptée.
  - `parsePlan returns [] for text with no task heading`.

- [ ] **Step 3: Lancer les tests et vérifier qu'ils échouent**

Run: `claude plugin test .`
Expected: FAIL (`parsePlan` introuvable).

- [ ] **Step 4: Implémenter `parsePlan(text: string): PlanTask[]` dans `src/plan.ts`**

Titre de tâche : `^#{1,6}[ \t]+Task[ \t]+([0-9]+[a-z]?)[ \t]*:?[ \t]*(.*)$` hors bloc de code. Blocs de code : une clôture ouvre avec N backticks ou tildes (N ≥ 3) et ne se ferme qu'avec au moins N caractères du même type (règle CommonMark). Étapes : lignes `^- \[[ xX]\] \*\*Step [0-9]+` dans l'étendue de la tâche, hors blocs.

- [ ] **Step 5: Vérifier**

Run: `claude plugin test . && npx tsc -p . && claude plugin validate .`
Expected : tests PASS, tsc sans erreur, validate sans refus.

- [ ] **Step 6: Commit**

```bash
git add .claude-plugin/plugin.json .claude-plugin/marketplace.json hooks types src tests tsconfig.json package.json package-lock.json .gitignore
git commit -m "feat: mod skeleton, model types and plan parser"
```

### Task 2: Parseur de ledger

**Files:**
- Create: `src/ledger.ts`, `tests/fixtures/ledgers.ts`
- Test: `tests/ledger.test.ts`

**Interfaces:**
- Consumes: `LedgerLine`, `Decision` (Task 1).
- Produces:
  - `parseLedger(text: string): LedgerLine[]` ;
  - `decisionsOf(lines: LedgerLine[]): Decision[]` (garde `minor`, `parked`, `ruling` dans l'ordre) ;
  - `tests/fixtures/ledgers.ts` exporte `SDD_LEDGER` et `DIRECT_LEDGER` (chaînes synthétiques, réutilisées en Task 5).

- [ ] **Step 1: Écrire les fixtures synthétiques**

Inventer un projet fictif (ex. « bibliothèque de recettes »). `SDD_LEDGER` contient : l'en-tête `# SDD ledger — plan: docs/superpowers/plans/2026-01-01-recettes.md`, des paragraphes libres en français, un tableau markdown de pre-flight, puis :
  - `Task 1: complete (commits a1b2c3d..e4f5a6b, review clean)`
  - `Task 2: fix round 1/5 (2 addressed, 0 open; commits e4f5a6b..0a1b2c3)`
  - `Task 2: complete (commits e4f5a6b..9f8e7d6c, 1 parked)` (SHA de 8 caractères)
  - `Task 2: parked — test de borne manquant — Ruling: hors périmètre`
  - `Task 3: minor (deferred): docblock incomplet`
  - `Task 3a: Ruling: helper renommé - plus lisible` (tiret court)
  - `Ruling: pas de worktree — conteneur monté sur le dossier — coût : branche dans le dossier principal`

  `DIRECT_LEDGER` contient `Pre-flight: no shared interfaces`, deux lignes `Task N: complete (commits x..y, tests: npm test → 12 passing)`, `Final review: self-review (no subagent tool)` et `Final: minor (deferred): nommage`.

- [ ] **Step 2: Écrire les tests qui échouent**

`tests/ledger.test.ts` :
  - `parseLedger reads completion lines in both executors` : sur `SDD_LEDGER`, les `complete` sont `['1', '2']` ; sur `DIRECT_LEDGER`, deux `complete`.
  - `parseLedger reads fix rounds` : `{ kind: 'fix-round', task: '2', round: 1 }`.
  - `parseLedger reads parked, minor and rulings with em or plain dash` : `{ kind: 'parked', task: '2', text: 'test de borne manquant — Ruling: hors périmètre' }`, `{ kind: 'minor', task: '3', text: 'docblock incomplet' }`, `{ kind: 'ruling', task: '3a', text: 'helper renommé - plus lisible' }`, une `ruling` sans tâche pour la ligne `Ruling:` seule, et `{ kind: 'minor', text: 'nommage' }` pour `Final: minor (deferred): nommage`.
  - `parseLedger ignores free prose and tables` : le nombre total de lignes rendues vaut exactement le nombre de lignes reconnues ci-dessus ; aucune exception.

- [ ] **Step 3: Lancer les tests et vérifier qu'ils échouent**

Run: `claude plugin test .`
Expected : FAIL (`parseLedger` introuvable).

- [ ] **Step 4: Implémenter `parseLedger` et `decisionsOf` dans `src/ledger.ts`**

Une regex par forme, ancrée en début de ligne (après des espaces éventuels). Tâche : `([0-9]+[a-z]?)`. Séparateurs : `—` ou `-`. Préfixe `Final:` → décision sans tâche.

- [ ] **Step 5: Vérifier**

Run: `claude plugin test . && npx tsc -p .`
Expected : PASS.

- [ ] **Step 6: Commit**

```bash
git add src/ledger.ts tests/ledger.test.ts tests/fixtures/ledgers.ts
git commit -m "feat: ledger parser"
```

### Task 3: Reducer — cycle de vie du run, tâches, agents, revue finale

**Files:**
- Create: `src/reduce.ts`, `src/reports.ts`
- Test: `tests/reduce.test.ts`

**Interfaces:**
- Consumes: types (Task 1), `decisionsOf` (Task 2).
- Produces:
  - `reduce(s: RunState | null, a: Action): RunState | null` dans `src/reduce.ts` ;
  - `newRun(stage: Stage, at: number, mode?: Mode): RunState` ;
  - `currentTask(s: RunState): TaskState | undefined` (la tâche `active`, sinon `undefined`) ;
  - `parseReport(role: AgentRoleName, answer: string): { status?: ImplementerStatus; verdict?: string; isClean?: boolean }` dans `src/reports.ts`.

Règles (le cœur de la tâche ; `turn-started` et `turn-ended` sont traités en Task 4 et laissent l'état inchangé ici) :

- **Nouveau run.** Ordre des étapes : brainstorm < plan < exec < final-review < finishing < done. `stage-entered` crée un run neuf (`newRun`) si `s` est `null`, si `s.stage` vaut `done`, ou si l'étape entrée est antérieure à `s.stage`. Sinon il fait avancer `s.stage` (jamais reculer) et fixe `mode` s'il est fourni. L'`id` est `run-<at>`.
- **Jalons.** Ajouter un `Milestone` pour : spec écrite (`spec écrite`), `phase-reported` `builder-check` (`builder check`), `awaiting-approval` (`spec à valider`), plan chargé (`<N> tâches · <M> étapes`), début d'exécution (`exec SDD` ou `exec direct`).
- **`phase-reported`** sans `agentId`, ou dont l'`agentId` n'a pas de tâche : les phases brainstorm et plan fixent `stagePhase` ; `red`, `green`, `refactor` s'appliquent à la tâche courante. Avec un `agentId` d'implémenteur : à la tâche de cet agent. Chaque phase de tâche ajoute un `TaskEvent` à `trail`.
- **`plan-loaded`** : fixe `planPath` et remplace `tasks`. Les tâches déjà `done` ou `active` gardent leur état si leur `n` existe encore. Si le run est en `brainstorm`, il passe en `plan`.
- **`workspace-found`** : fixe `workspace` et `planPath`.
- **`task-started`** : la tâche passe `active` (les autres `active` restent `active` seulement si l'exécution est groupée ; par défaut, une seule tâche active), `startedAt` (si absent), `trail` + `brief`. Une tâche absente du plan est ajoutée avec `title: '?'` et `steps: 0`.
- **`agent-dispatched`** : enregistre `agents[agentId]`. Si un `pendingAnswer` existait pour cet id, il est appliqué ensuite comme un `agent-reported`. Effets par rôle :
  - `implementer` : la tâche passe `active`, `implementerId`, `trail` + `writing`. Si la tâche avait déjà une relecture, c'est un fix (cas des rounds 4 et 5) : `fixRounds + 1`, `trail` + `fix` avec `round`.
  - `reviewer` : `trail` + `review`.
  - `re-reviewer` : `trail` + `re-review` avec `round`.
  - `final-reviewer` : le run passe en `final-review`, `finalReview = { phase: 'review' }`.
  - `other`, pendant que la tâche courante a une relecture non propre : fix, comme pour `implementer`. Pendant `final-review` avec un verdict non propre : `finalReview.phase = 'fixes'`.
  - `builder-check` : jalon (voir plus haut).
- **`agent-resumed`** d'un `implementerId` dont la tâche a une relecture non propre : `fixRounds + 1`, `trail` + `fix` avec `round`. L'agent repasse `isRunning: true`.
- **`agent-reported`** : agent inconnu → `agents[id] = { role: 'unknown', isRunning: false, pendingAnswer: answer }`. Sinon `isRunning: false` et `parseReport(role, answer)` :
  - implémenteur : `lastStatus` ;
  - relecteur ou re-relecteur : `verdict` sur le dernier `TaskEvent` du rôle ; un re-relecteur au round 5 avec `isClean: false` met `isBreakerTripped: true` ;
  - relecteur final : `finalReview.verdict`. Si `isClean`, `finalReview.phase = 'done'`. Sinon `'fixes'`, et en mode `direct` les corrections commencent tout de suite.
- **`parseReport`** :
  - `**Status:** X` → `status` ;
  - `**Task quality:** Approved` → `{ verdict: 'ok', isClean: true }`, `Needs fixes` ou tout `❌` → `{ verdict: 'à corriger', isClean: false }` ;
  - `**Fix round:** All findings addressed` → `ok`/propre, `Findings remain open` → `ouvert`/non propre ;
  - `**Ready to merge?** Yes` → `prêt`/propre, `With fixes` → `avec corrections`/non propre, `No` → `non`/non propre ;
  - rien de reconnu → `{}`.
- **`task-verified`** : `isOk` → tâche `done`, `doneAt`, `trail` + `verify` puis `done`. Sinon `trail` + `verify` avec `verdict: 'échec'`.
- **`ledger-loaded`** : chaque `complete` passe la tâche `done` (avec `doneAt = at` si absent). `fix-round` porte `fixRounds` au moins au round lu. `decisions = decisionsOf(lines)`.
- **`workspace-removed`** : si le run est en `final-review` ou `exec`, `finalReview.phase = 'done'`.
- **`branch-finished`** : `stage = 'done'`, `finishedAt = at`.

- [ ] **Step 1: Écrire les tests qui échouent**

`tests/reduce.test.ts` :
  - `stage-entered starts a run and advances without going back` : brainstorm → plan → exec ; puis `stage-entered plan` alors que le run est en `exec` → nouveau run (id différent) en `plan`.
  - `stage-entered exec on a null state starts a run at exec with mode`.
  - `plan-loaded replaces tasks and keeps done ones`.
  - `sdd task flows through writing, review, fix and re-review` : `task-started 1`, implémenteur dispatché (`a1`), rapport `**Status:** DONE`, relecteur (`r1`) rapport `**Task quality:** Needs fixes`, `agent-resumed a1` → `fixRounds 1`, re-relecteur round 1 rapport `**Fix round:** All findings addressed`, ledger `complete 1` → tâche `done`, `trail` = `brief, writing, review, fix, re-review, done` (phases dans cet ordre).
  - `report arriving before dispatch is applied on dispatch` (Review Focus 2) : `agent-reported x` avec `**Status:** BLOCKED`, puis `agent-dispatched x implementer task 2` → `lastStatus` vaut `BLOCKED` pour la tâche 2.
  - `fifth unclean re-review trips the breaker`.
  - `final review not clean in direct mode moves to fixes`.
  - `branch-finished ends the run`.
  - `tdd phases reported by an implementer land on its task` : `phase-reported red` avec l'`agentId` de l'implémenteur de la tâche 2 alors que la tâche courante est la 2 → `trail` de la tâche 2 contient `red`.

- [ ] **Step 2: Lancer les tests et vérifier qu'ils échouent**

Run: `claude plugin test .`
Expected : FAIL (`reduce` introuvable).

- [ ] **Step 3: Implémenter `reduce`, `newRun`, `currentTask` dans `src/reduce.ts` et `parseReport` dans `src/reports.ts`**

Mises à jour immuables : `RunState` est rangé dans `$.state`, il ne doit jamais être muté.

- [ ] **Step 4: Vérifier**

Run: `claude plugin test . && npx tsc -p .`
Expected : PASS.

- [ ] **Step 5: Commit**

```bash
git add src/reduce.ts src/reports.ts tests/reduce.test.ts
git commit -m "feat: run reducer for stages, tasks, agents and final review"
```

### Task 4: Attente et politique de notification

**Files:**
- Modify: `src/reduce.ts` (cas `turn-started`, `turn-ended`)
- Create: `src/notify.ts`
- Test: `tests/waiting.test.ts`

**Interfaces:**
- Consumes: `reduce`, `currentTask` (Task 3).
- Produces:
  - `reduce` gère `turn-started` (efface `waiting`) et `turn-ended` ;
  - `waitText(s: RunState): string` dans `src/notify.ts` ;
  - `notificationFor(prev: RunState | null, next: RunState | null): string | undefined`.

Règles de `turn-ended` (tour de la boucle principale seulement ; le glue n'émet `turn-ended` que sans `agentId`) :
- Si un agent a `isRunning: true`, pas d'attente (Review Focus 1).
- Sinon `waiting = { reason, task?, since: at }` avec `reason` :
  - `brainstorm` : `spec-approval` si `stagePhase` vaut `awaiting-approval`, sinon `brainstorm-question` ;
  - `plan` : `execution-choice` si `tasks.length > 0`, sinon `other` ;
  - `exec` : `breaker` si la tâche courante a `isBreakerTripped`, sinon `blocked` si son `lastStatus` vaut `BLOCKED`, sinon `other` ;
  - `final-review` : `other` ;
  - `finishing` : `finishing-menu` ;
  - `done` : pas d'attente.

`waitText` (texte exact) :
- `brainstorm-question` → `question en cours`
- `spec-approval` → `spec à valider`
- `execution-choice` → `plan prêt (<N> tâches) · choisis le mode d'exécution`
- `blocked` → `Task <n> bloquée`
- `breaker` → `Task <n> · 5 fix rounds épuisés`
- `finishing-menu` → `prêt pour ton test · menu de fin de branche`
- `other` → `à toi`

`notificationFor` rend `waitText(next)` quand `next.waiting` existe, que sa raison est parmi `execution-choice`, `blocked`, `breaker`, `finishing-menu`, et que `prev` n'avait pas d'attente, ou une attente de raison ou de `since` différente. Sinon `undefined`.

- [ ] **Step 1: Écrire les tests qui échouent**

`tests/waiting.test.ts` :
  - `turn end with a running background agent is not waiting` (Review Focus 1).
  - `turn end in plan with tasks waits for the execution choice` et `waitText` vaut `plan prêt (3 tâches) · choisis le mode d'exécution`.
  - `turn end with a blocked implementer waits as blocked`.
  - `turn end in finishing waits on the finishing menu`.
  - `turn-started clears waiting`.
  - `notificationFor fires once per wait and never for brainstorm questions` : une même attente deux fois → une seule notification ; `brainstorm-question` et `spec-approval` → `undefined`.

- [ ] **Step 2: Lancer les tests et vérifier qu'ils échouent**

Run: `claude plugin test .`
Expected : FAIL.

- [ ] **Step 3: Implémenter les cas dans `reduce`, puis `waitText` et `notificationFor` dans `src/notify.ts`**

- [ ] **Step 4: Vérifier**

Run: `claude plugin test . && npx tsc -p .`
Expected : PASS.

- [ ] **Step 5: Commit**

```bash
git add src/reduce.ts src/notify.ts tests/waiting.test.ts
git commit -m "feat: waiting states and notification policy"
```

### Task 5: Détecteurs superpowers 7.0.0 et rejeu

**Files:**
- Create: `src/detectors/sp-7.0.0.ts`, `src/detectors/index.ts`, `tests/fixtures/runs.ts`
- Test: `tests/detect.test.ts`, `tests/replay.test.ts`

**Interfaces:**
- Consumes: types, `parsePlan`, `parseLedger`, `reduce`.
- Produces:
  - `detect(e: ObservedEvent, s: RunState | null): Detection` (réexporté par `src/detectors/index.ts`) ;
  - `MARKERS: readonly Marker[]` avec `type Marker = { id: string; file: string; pattern: RegExp }` (`file` relatif à la racine de superpowers), exporté par `sp-7.0.0.ts` et utilisé en Task 10 ;
  - `replay(events: ObservedEvent[], files?: Record<string, string>): RunState | null` dans `src/detectors/index.ts`. Il applique `detect` puis `reduce` pour chaque event et sert les `reads` depuis `files`, dont il réinjecte le contenu comme events `file`.

Règles de `detect` (correspondance sur le nom de base des scripts n'importe où dans la commande Bash ; `text` est la sortie de l'outil) :

| Entrée | Actions / lectures |
|---|---|
| `skill` `superpowers:X` ou `X` | X = `brainstorming` → `stage-entered brainstorm` ; `writing-plans` → `plan` ; `subagent-driven-development` → `exec` mode `sdd` ; `executing-plans` → `exec` mode `direct` ; `finishing-a-development-branch` → `finishing`. Autres skills : rien. |
| tool `mcp__superpowers-statusbar__report_phase` | `phase-reported` (`input.phase`, `agentId`) si la phase est une `ReportedPhase` connue. |
| tool `Write` d'un `.md` pendant `brainstorm`, chemin contenant `/specs/` ou finissant par `-design.md` | `spec-written`. |
| tool `Write` d'un `.md` avant `exec`, dont `parsePlan(content)` rend au moins une tâche | `plan-loaded` avec ces tâches. |
| Bash `sdd-workspace <PLAN>` réussi | `workspace-found` (dernière ligne non vide de la sortie, `planPath` = argument) ; `stage-entered exec` si le run n'est pas déjà en `exec` ou au-delà ; lectures `plan` (PLAN) et `ledger` (`<workspace>/progress.md`). |
| Bash `task-brief <PLAN> <N>` réussi | `task-started N`. |
| Bash `task-start <PLAN> <N>` réussi | `task-started N`. |
| Bash `task-done <PLAN> <N> <BASE> --` | `task-verified N`, `isOk` = pas d'erreur et sortie contenant `ledger: Task`. |
| Bash `rm -rf …/.superpowers/sdd/<slug>` | `workspace-removed`. |
| Bash `git merge`, `git push` ou `gh pr create` pendant `finishing` | `branch-finished`. |
| tool `Write`, `Edit` ou Bash dont l'entrée mentionne `progress.md`, workspace connu | lecture `ledger` (`<workspace>/progress.md`). |
| tool `Agent` (résultat avec `agentId`) | `agent-dispatched`, rôle selon `description` : `^Implement Task (\S+?):?\s` → implementer ; `^Review Task (\S+) \(spec \+ quality\)` → reviewer ; `^Re-review Task (\S+) fix round (\d+)` → re-reviewer (round) ; `^Review code changes` quand le run est en `exec` ou `final-review` → final-reviewer ; `prompt` commençant par `You are a talented` et contenant `design document` → builder-check. Repli sur la première ligne du `prompt` : `You are implementing Task (\S+?):`, `You are reviewing one task's implementation`, `You are re-reviewing one task's fix round`, `You are a Senior Code Reviewer`. Sinon `other`. `isRunning` vaut `true` si `result.status` vaut `async_launched`, sinon `false`. Résultat `completed` : émettre aussi `agent-reported` avec le texte de `result.content`. |
| tool `SendMessage` dont `input.to` est un agent connu | `agent-resumed`. |
| `turn-end` avec `agentId` | `agent-reported` (`answer`). |
| `turn-end` sans `agentId` | `turn-ended`. |
| `turn-start` | `turn-started`. |
| `file` `plan` | `plan-loaded` (`parsePlan`). |
| `file` `ledger` | `ledger-loaded` (`parseLedger`). |

`MARKERS` : un marqueur par dépendance du tableau ci-dessus, avec un `id` qui nomme la règle (`skill.brainstorming`, `script.sdd-workspace`, `script.task-brief.output`, `script.task-done.ledger`, `dispatch.implementer`, `dispatch.reviewer`, `dispatch.re-reviewer`, `dispatch.final-reviewer`, `dispatch.builder-check`, `report.status`, `report.task-quality`, `report.fix-round`, `report.ready-to-merge`, `ledger.complete`, `ledger.fix-round`, `plan.task-heading`, `plan.step`, `workspace.path`…). Chaque `pattern` est copié du fichier de superpowers 7.0.0 qu'il vise (ex. `skills/subagent-driven-development/implementer-prompt.md` doit contenir `Implement Task N`). Ouvrir chaque fichier pour en recopier la chaîne exacte.

- [ ] **Step 1: Écrire les séquences synthétiques**

`tests/fixtures/runs.ts` exporte :
- `SDD_RUN: ObservedEvent[]` : un run complet de 2 tâches. Il couvre : skills brainstorming → writing-plans, Write de la spec, `report_phase` (conversation, design-writing, awaiting-approval, drafting, self-review), Write du plan, skill subagent-driven-development, `sdd-workspace`, puis pour chaque tâche `task-brief`, l'implémenteur en `async_launched` et son `turn-end`, le relecteur, et pour la tâche 2 un `SendMessage` de fix et une re-review. Viennent ensuite un Write de `progress.md`, le relecteur final, `rm -rf` du workspace, le skill finishing, un `turn-end` principal, un `turn-start` et `git merge`.
- `DIRECT_RUN: ObservedEvent[]` : le même run en exécution directe, avec `task-start`, des `report_phase` red/green/refactor et `task-done`.
- `FILES: Record<string, string>` : le plan (2 tâches) et le ledger, réutilisant le style de `tests/fixtures/ledgers.ts`.

- [ ] **Step 2: Écrire les tests qui échouent**

- `tests/detect.test.ts` : un test par ligne du tableau. Exemples : `detect maps an async Implement Task dispatch to a running implementer`, `detect reads the workspace path from sdd-workspace output`, `detect ignores skills outside the run chain`, `detect ignores report_phase with an unknown phase`.
- `tests/replay.test.ts` :
  - `replaying an SDD run ends done with every task done and one fix round on task 2` ;
  - `replaying a direct run records red, green, refactor and verify on each task` ;
  - `replaying stops waiting while the background implementer runs` : on coupe `SDD_RUN` juste après le `turn-end` principal qui suit le dispatch asynchrone → pas de `waiting`.

- [ ] **Step 3: Lancer les tests et vérifier qu'ils échouent**

Run: `claude plugin test .`
Expected : FAIL.

- [ ] **Step 4: Implémenter `detect`, `MARKERS` et `replay`**

- [ ] **Step 5: Vérifier**

Run: `claude plugin test . && npx tsc -p .`
Expected : PASS.

- [ ] **Step 6: Commit**

```bash
git add src/detectors tests/detect.test.ts tests/replay.test.ts tests/fixtures/runs.ts
git commit -m "feat: superpowers 7.0.0 detectors and replay"
```

### Task 6: Vues — bande, pane, estimation

**Files:**
- Create: `src/view.ts`
- Test: `tests/view.test.ts`

**Interfaces:**
- Consumes: `RunState`, `currentTask`, `waitText`.
- Produces:
  - `type Tone = 'normal' | 'dim' | 'ok' | 'active' | 'todo' | 'wait' | 'accent'` ;
  - `type Segment = { text: string; tone: Tone; isBold?: boolean }` ;
  - `bandSegments(s: RunState, now: number, columns: number): Segment[]` ;
  - `paneModel(s: RunState, now: number, rows: number): PaneModel` ;
  - `estimate(s: RunState, now: number): { avgMs: number; remainingMs: number; finishAt: number } | undefined` ;
  - `formatDuration(ms: number): string` ;
  - `formatClock(at: number): string` ;
  - `stageLabel(s: RunState): string` ;
  - `phaseLabel(e: TaskEvent): string`.

```ts
export type PaneModel = {
  title: string                 // 'superpowers · <slug du plan>' ou 'superpowers' sans plan
  elapsed?: string
  stages: { label: string; status: 'done' | 'active' | 'todo' | 'skipped'; detail?: string }[]
  tasks: { n: string; title: string; status: TaskState['status']; duration?: string; fixRounds: number }[]
  hiddenTasks: number           // replié en « (+N) »
  current?: { n: string; trail: string[] }  // libellés déjà formatés, verdicts entre parenthèses
  decisions: Decision[]
  eta?: string                  // 'moy. 6 min/tâche · reste ~50 min · fin vers 16:40'
}
```

Libellés exacts :
- Étapes : `brainsto`, `plan`, `exec SDD` / `exec direct` (`exec` sans mode), `revue finale`, `fin de branche`, `terminé`.
- Phases rapportées : `conversation`, `rédaction de la spec`, `spec en relecture` (builder-check), `spec à valider`, `rédaction`, `relecture du plan`. Plan chargé sans phase : `<N> tâches`.
- Phases de tâche : `brief`, `écriture`, `relecture`, `fix <r>/5`, `re-review <r>`, `RED`, `GREEN`, `refactor`, `vérif`, `terminée`, `?`.
- Revue finale : `revue finale`, `revue finale · corrections`.

Bande, run en cours, segments dans l'ordre :
1. voyant `●` (`active`) ;
2. libellé d'étape ;
3. barre de 15 cellules `▰`/`▱` (pleines = `round(done / total × 15)`, tons `ok`/`todo`) ;
4. compteur `<done>/<total>` en gras ;
5. `Task <n> « <titre> »` ;
6. phase de la tâche courante ;
7. `fix <r>/5` si `fixRounds > 0` et que la phase n'en est pas déjà un ;
8. durée écoulée (`formatDuration(now - startedAt)`, absente si `startedAt` vaut 0).

Séparateurs (segments à part entière, ton `dim`) : une espace entre voyant, étape, barre et compteur ; ` · ` entre tous les segments qui suivent le compteur. Les segments 3 à 5 n'apparaissent qu'en `exec`. En brainstorm et plan : voyant, étape, ` · `, phase rapportée (ex. `● brainsto · spec à valider`).

En attente : segment `T'ATTEND` (ton `wait`, gras) en tête, puis `waitText(s)`.

Run `done` : `✓ terminé · <N> tâches · <F> fix rounds · <D> points mis de côté · <durée>`, où D compte les `parked` et `minor`.

Réduction à `columns` (longueur en caractères de la somme des textes) : retirer d'abord la durée, puis le titre de la tâche, puis la barre. Voyant, étape et compteur restent toujours.

`estimate` : moyenne `doneAt - startedAt` des tâches `done` dont les deux valeurs sont non nulles, multipliée par le nombre de tâches non terminées. `undefined` sans tâche mesurée ou sans tâche restante.

`formatDuration` : `< 1 h` → `<m> min` ; sinon `<h> h <mm>` (ex. `1 h 05`). `formatClock` : `HH:MM` en heure locale.

Pane :
- `tasks` montre au plus `rows - 14` lignes (minimum 3) centrées sur la tâche courante ;
- `hiddenTasks` compte le reste ;
- une étape jamais entrée mais dépassée vaut `skipped`.

- [ ] **Step 1: Écrire les tests qui échouent**

`tests/view.test.ts`, sur des `RunState` construits à la main (ou issus de `replay` sur les fixtures de la Task 5) :
  - `band shows stage, bar, counter, task title, phase, fix round and elapsed` : texte des segments joints sans séparateur ajouté, égal à `● exec SDD ▰▰▰▰▰▰▱▱▱▱▱▱▱▱▱ 7/15 · Task 7 « Parser du ledger » · relecture · fix 2/5 · 42 min`.
  - `band drops elapsed, then title, then bar as columns shrink` (Review Focus 5) : à 30 colonnes le texte contient `exec SDD` et `7/15`.
  - `band leads with T'ATTEND and the wait text when waiting`.
  - `band summarises a finished run`.
  - `band in brainstorm shows the reported phase`.
  - `estimate averages measured tasks only` : une tâche reconstruite avec `startedAt: 0` est ignorée.
  - `formatDuration formats minutes and hours`.
  - `paneModel folds tasks around the current one` : 15 tâches, 10 lignes disponibles → la tâche courante est présente et `hiddenTasks > 0`.
  - `paneModel marks unreached earlier stages as skipped` : run démarré en `exec`.

- [ ] **Step 2: Lancer les tests et vérifier qu'ils échouent**

Run: `claude plugin test .`
Expected : FAIL.

- [ ] **Step 3: Implémenter `src/view.ts`**

- [ ] **Step 4: Vérifier**

Run: `claude plugin test . && npx tsc -p .`
Expected : PASS.

- [ ] **Step 5: Commit**

```bash
git add src/view.ts tests/view.test.ts
git commit -m "feat: band and pane view models"
```

### Task 7: Couche mod — observation, instrumentation, notifications, trace

**Files:**
- Create: `src/instrument.ts`, `hooks/normalize.ts`, `hooks/runtime.ts`, `hooks/state.ts`
- Modify: `hooks/register.tsx`
- Test: `tests/instrument.test.ts`, `tests/hooks.test.ts`

**Interfaces:**
- Consumes: `detect`, `reduce`, `notificationFor`.
- Produces:
  - `src/instrument.ts` :
    - `REPORT_TOOL: { name: 'report_phase'; description: string; inputSchema: Record<string, unknown>; isDeferred: false }` ;
    - `instrumentSkill(skill: string, text: string): string` (texte inchangé hors des trois skills) ;
    - `PHASES_BY_SKILL: Record<'brainstorming' | 'writing-plans' | 'test-driven-development', readonly ReportedPhase[]>`.
  - `src/trace.ts` : `traceEntry(a: Action, s: RunState | null): TraceEntry`. Il est rempli depuis l'état après l'action : `stage`, `mode`, le `n` de la tâche courante (ou de la tâche nommée par l'action), la phase du dernier `TaskEvent` de cette tâche, la raison d'attente. Il est réutilisé par les tests de la Task 12.
  - `hooks/state.ts` : `runAtom` = `atom({ plugin: 'superpowers-statusbar', key: 'run' } as const, null)`.
  - `hooks/normalize.ts` : `toolEvent(e: ToolCallInput, ran: ToolCallResult, at: number): ObservedEvent` (les champs d'entrée de l'outil sont à plat sur `e` : retirer l'enveloppe `tool`, `tool_use_id`, `agentId` et les méta pour former `input`) ; `skillName(skill: string): string` (retire un préfixe `superpowers:`).
  - `hooks/runtime.ts` : `observe($: EngineInterface, e: ObservedEvent, options: PluginOptions): Promise<void>`. Il fait tourner `detect` puis `reduce` sur l'état lu dans `runAtom`, sert chaque `FileRequest` par `$.fs.read` et réinjecte la réponse comme event `file` (un fichier absent est ignoré). Il écrit l'état final avec `update`. Il envoie `$.ui.notify(text, { title: 'superpowers' })` si `notificationFor(prev, next)` rend un texte et que `options.notifications` est vrai. Il ajoute une `TraceEntry` au fichier désigné par la variable d'environnement `SP_STATUSBAR_TRACE` (lue via `$.env.get`), en réécrivant le fichier entier en JSON Lines depuis une liste gardée en `$.state` ou en mémoire (au choix de l'implémenteur).

Texte exact ajouté à la fin du skill (`<phases>` remplacé par une ligne `- \`<phase>\`: <quand>` par phase du skill) :

```
## Progress reporting (superpowers-statusbar)

A status bar is tracking this run for your human partner. Each time you move into one of the phases below, call the tool `mcp__superpowers-statusbar__report_phase` once with that phase, then carry on. It is a signal only: it changes nothing about how you follow this skill, and you report nothing else.

<phases>
```

Phases et « quand » :
- brainstorming :
  - `conversation` : you are asking questions or playing understanding back ;
  - `design-writing` : you are writing the design document ;
  - `builder-check` : the builder check subagent is reading the document ;
  - `awaiting-approval` : the document is handed over for approval.
- writing-plans :
  - `drafting` : you are writing the plan ;
  - `self-review` : you are running the self-review checklist.
- test-driven-development :
  - `red` : you are writing a failing test and watching it fail ;
  - `green` : you are writing the minimal code to make it pass ;
  - `refactor` : you are cleaning up with the tests green.

`REPORT_TOOL.description` : `Reports the current superpowers phase to the status bar. Call it only when a skill's "Progress reporting" section asks you to.` Schéma : objet, `phase` chaîne requise, `enum` des neuf phases. La réponse du hook à un appel de l'outil est `{ text: 'ok' }` (consulter `ToolCallResult` pour la forme exacte d'un résultat rendu par un plugin).

Câblage dans `hooks/register.tsx` :
- `session.start` : `$.tool.register(REPORT_TOOL)` et `$.command.register({ name: 'sp-progress', description: 'Ouvre ou ferme le pane de progression superpowers' })` (le pane vient en Task 8), puis `next(e)`.
- `skill.prompt` : `observe` d'un event `skill`, puis `next({ ...e, text: instrumentSkill(skillName(e.skill), e.text) })`.
- `tool.call` sur `mcp__superpowers-statusbar__report_phase` : répond lui-même (sans `next`), puis `observe`.
- `tool.call` sur les autres outils : `const ran = await next(e)`, puis `observe(toolEvent(e, ran, now))`. Ce hook rend toujours `ran` et attrape ses propres erreurs : il ne doit jamais casser un appel d'outil (`.catch(($, e, next) => next(e))`).
- `turn.start` : event `turn-start`.
- `turn.complete` : event `turn-end` (`agentId`, `answer`).
- `session.end` avec `reason: 'clear'` : remettre `runAtom` à `null`.
- L'heure vient de `$.clock.now()`.

- [ ] **Step 1: Écrire les tests qui échouent**

- `tests/instrument.test.ts` :
  - `instrumentSkill appends the reporting section to the three skills only` ;
  - `instrumentSkill keeps the original text as a prefix` (anti-objectif : rien n'est retiré ni réécrit) ;
  - `REPORT_TOOL enum lists every ReportedPhase`.
  - `traceEntry carries the current task and its last phase`.
- `tests/hooks.test.ts` (le `$` du kit et les hooks de test au fond de la chaîne) :
  - `skill.prompt for superpowers:writing-plans returns the instrumented text` ;
  - `report_phase calls are answered by the mod and update the run` : `$.skill.prompt` brainstorming, puis `$.tool.call` de l'outil avec `phase: 'awaiting-approval'` → l'état lu par `$.state.get` a `stagePhase` égal à `awaiting-approval` ;
  - `a Bash sdd-workspace call starts exec and reads the plan through $.fs` : un hook de test au fond de `tool.call` rend la sortie, et `mock` sert le plan à `$.fs.read`. Si le kit ne permet pas de simuler `$.fs`, tester `observe` avec un `$` partiel et le signaler dans le rapport ;
  - `notifications respect the notifications option` : `test(name, { options: { notifications: false } }, …)` → aucun `ui.notify` n'est vu par un hook de test sur `ui.notify` ;
  - `a failing observer never breaks the tool call`.

- [ ] **Step 2: Lancer les tests et vérifier qu'ils échouent**

Run: `claude plugin test .`
Expected : FAIL.

- [ ] **Step 3: Implémenter `src/instrument.ts`, `hooks/state.ts`, `hooks/normalize.ts`, `hooks/runtime.ts` et le câblage**

- [ ] **Step 4: Vérifier**

Run: `claude plugin test . && npx tsc -p . && claude plugin validate .`
Expected : PASS. `validate` liste les hooks `session.start`, `skill.prompt`, `tool.call`, `turn.start`, `turn.complete`, `session.end`, ne signale aucun refus, et liste l'outil enregistré.

- [ ] **Step 5: Commit**

```bash
git add src/instrument.ts src/trace.ts hooks tests/instrument.test.ts tests/hooks.test.ts
git commit -m "feat: mod runtime, phase instrumentation and notifications"
```

### Task 8: Bande, pane, commande `/sp-progress`, README

**Files:**
- Create: `hooks/band.tsx`, `hooks/pane.tsx`
- Modify: `hooks/register.tsx`, `README.md`
- Test: `tests/ui.test.tsx`

**Interfaces:**
- Consumes: `bandSegments`, `paneModel`, `runAtom`, `observe`.
- Produces :
  - `renderBand($, e, next)` pour `{ component: 'AbovePrompt' }` ;
  - `renderPane($, e)` pour `{ component: 'Pane', requestId: 'sp-progress' }` ;
  - `PANE_ID = 'sp-progress'`, titre `superpowers`.

Règles :
- **Bande** : sans run (`null`), ou si `e.props.hasSurvey` est vrai, rendre `next(e)`. Sinon une `Box` d'une ligne : un `Text` par segment, avec les correspondances de ton suivantes :
  - `dim` → `dimColor` ;
  - `ok` → vert ;
  - `active` → jaune ;
  - `todo` → gris ;
  - `wait` → fond orange, texte foncé, gras ;
  - `accent` → bleu.

  Largeur : `e.props.bodyColumns`. Surfaces `terminal` et `desktop` : même arbre. Surfaces `vscode` et `mobile` : `next(e)`.
- **Pane** : les cinq blocs de `PaneModel` dans l'ordre :
  1. étapes (`✓`, `●`, `○`, `–`) ;
  2. tâches (statut, numéro, titre, durée, fix) ;
  3. tâche en cours (fil joint par ` → `) ;
  4. décisions (`Ruling`, `minor`, `parked` en tête de ligne) ;
  5. estimation.

  Titres de blocs : `ÉTAPES`, `TÂCHES`, `TÂCHE EN COURS`, `DÉCISIONS & MIS DE CÔTÉ`, `ESTIMATION`. Un bloc vide est omis. Hauteur : `e.viewport?.rows ?? 24`.
- **Commande `sp-progress`** : ouvre le pane (`$.ui.open({ id: PANE_ID, title: 'superpowers' })`) ou le ferme (`$.ui.close`) s'il est ouvert. L'état ouvert ou fermé est gardé en `$.state` (clé `isPaneOpen` à ajouter au contrat). Réponse : `{ text: 'Pane de progression ouvert.' }` ou `{ text: 'Pane de progression fermé.' }`.
- **Ouverture automatique** : quand une observation fait passer le run en `exec`, et que la dernière `e.viewport.isFullscreen` vue par la bande valait `true`, appeler `$.ui.open` sans attendre (`void`).
- **README** :
  - ce que fait le mod ;
  - installation `/plugin install superpowers-statusbar --marketplace AdrienGras/superpowers-statusbar` (avec `y` pour ajouter le marketplace, puis le scope) ;
  - développement `claude --plugin-dir /chemin/vers/superpowers-statusbar` ;
  - `/sp-progress` ;
  - l'option `notifications` ;
  - comment couper la notification générique de Claude Code si le doublon gêne (réglage `preferredNotifChannel` ou les hooks `Notification` de l'utilisateur, selon ce que la doc Claude Code indique au moment de l'écriture) ;
  - superpowers 7.0.0 requis.

- [ ] **Step 1: Écrire les tests qui échouent**

`tests/ui.test.tsx`, avec une boucle sur `['terminal', 'desktop'] as const` là où l'arbre est le même :
  - `band draws nothing without a run` : le montage rend l'arbre de l'engine (aucun `Text` du mod).
  - `band draws the running line` : après un rejeu de `SDD_RUN` coupé en pleine tâche, `find({ type: 'Text', text: /\/2/ })` est défini.
  - `band draws T'ATTEND when waiting`.
  - `pane shows the five block titles for a run with decisions and an estimate`.
  - `sp-progress opens then closes the pane` : `$.command.run` deux fois, textes de réponse attendus.

- [ ] **Step 2: Lancer les tests et vérifier qu'ils échouent**

Run: `claude plugin test .`
Expected : FAIL.

- [ ] **Step 3: Implémenter `hooks/band.tsx`, `hooks/pane.tsx`, la commande, l'ouverture automatique et le README**

- [ ] **Step 4: Vérifier**

Run: `claude plugin test . && npx tsc -p . && claude plugin validate .`
Expected : PASS, sans refus.

- [ ] **Step 5: Commit**

```bash
git add hooks tests/ui.test.tsx types/index.d.ts README.md
git commit -m "feat: band, pane and /sp-progress"
```

### Task 9: Reconstruction depuis le transcript de la session

**Files:**
- Create: `src/rebuild.ts`
- Modify: `hooks/register.tsx` (`session.start`)
- Test: `tests/rebuild.test.ts`

**Interfaces:**
- Consumes: `detect`, `reduce` (Task 3-5), `observe` (Task 7) pour servir les lectures. `src/` ne dépend jamais de `hooks/`.
- Produces :
  - `messagesToEvents(messages: readonly { role: 'user' | 'assistant'; text: string; toolUses: readonly { tool: string; input: Record<string, unknown>; result?: unknown; text?: string; isError?: true; agentId?: string }[] }[]): ObservedEvent[]` dans `src/rebuild.ts`. Le type de paramètre est structurel : il reprend la forme de `SessionMessage` sans importer `'claude-code'`.

Règles :
- **Conversion.** Chaque `toolUse` devient un event `tool` avec `at: 0`. Un `toolUse` `Skill` devient en plus un event `skill` (`input.skill`), placé avant l'event `tool`. Un message `assistant` qui termine la conversation n'émet pas de `turn-end`.
- **`session.start`.** Si `runAtom` vaut déjà autre chose que `null` (rechargement, compaction), ne rien faire. Sinon lire `$.session.messages()`. Vide → rien (session fraîche : rien n'est adopté depuis le disque). Non vide → rejouer les events dans `detect` + `reduce` avec les lectures servies par `$.fs.read`, puis écrire l'état.
- **Garde-fou.** Un run reconstruit sans aucun event de la chaîne (aucun skill superpowers ni script) reste `null`.

- [ ] **Step 1: Écrire les tests qui échouent**

`tests/rebuild.test.ts` :
  - `messagesToEvents turns tool uses into events with unknown time` ;
  - `messagesToEvents emits a skill event for Skill tool uses` ;
  - `rebuild of a transcript without superpowers activity stays null` ;
  - `a fresh session with no messages adopts nothing` : test de hook ; un `$.fs` qui servirait un workspace n'est jamais lu, et l'état reste `null` ;
  - `rebuild of a mid-run transcript restores the current task` : messages construits depuis `SDD_RUN` coupé à la tâche 2 → tâche 1 `done`, tâche 2 `active`, durées inconnues.

- [ ] **Step 2: Lancer les tests et vérifier qu'ils échouent**

Run: `claude plugin test .`
Expected : FAIL.

- [ ] **Step 3: Implémenter `messagesToEvents` et la reconstruction dans `session.start`**

- [ ] **Step 4: Vérifier**

Run: `claude plugin test . && npx tsc -p .`
Expected : PASS.

- [ ] **Step 5: Commit**

```bash
git add src/rebuild.ts hooks/register.tsx tests/rebuild.test.ts
git commit -m "feat: rebuild the run from the session transcript"
```

### Task 10: Contrat statique contre une version de superpowers

**Files:**
- Create: `src/contract.ts`, `scripts/contract-check.ts`, `tsconfig.scripts.json`
- Modify: `package.json` (script `contract`)
- Test: `tests/contract.test.ts`

**Interfaces:**
- Consumes: `MARKERS` (Task 5).
- Produces:
  - `checkContract(markers: readonly Marker[], read: (file: string) => string | undefined): { id: string; file: string; problem: 'missing-file' | 'missing-marker' }[]` dans `src/contract.ts` ;
  - CLI `node scripts/contract-check.ts <dossier superpowers>`. Elle affiche une ligne par problème (`✗ <id> — <file> : marqueur absent` ou `fichier absent`), puis `✓ <n> marqueurs OK` s'il n'y en a aucun, et sort avec le code 1 en cas de problème.

`tsconfig.scripts.json` : comme `tsconfig.json` mais `types: ["node"]`, `include: ["scripts", "src", "types"]`. Le script `typecheck` de `package.json` lance les deux configurations.

- [ ] **Step 1: Écrire les tests qui échouent**

`tests/contract.test.ts` :
  - `checkContract passes when every marker is found` ;
  - `checkContract reports missing files and missing markers by id`.

- [ ] **Step 2: Lancer les tests et vérifier qu'ils échouent**

Run: `claude plugin test .`
Expected : FAIL.

- [ ] **Step 3: Implémenter `checkContract`, la CLI et la configuration**

- [ ] **Step 4: Vérifier sur la vraie version 7.0.0**

Run: `node scripts/contract-check.ts ~/.claude/plugins/cache/superpowers-marketplace/superpowers/7.0.0`
Expected : `✓ <n> marqueurs OK`, code 0. Un marqueur absent signale une erreur de recopie dans `MARKERS`, à corriger dans `sp-7.0.0.ts`.

Run: `claude plugin test . && npm run typecheck`
Expected : PASS.

- [ ] **Step 5: Commit**

```bash
git add src/contract.ts scripts/contract-check.ts tsconfig.scripts.json package.json tests/contract.test.ts
git commit -m "feat: static contract check against a superpowers version"
```

### Task 11: Tests locaux sur données réelles

**Files:**
- Create: `scripts/local-fixtures.ts`
- Modify: `package.json` (script `local`)

**Interfaces:**
- Consumes: `parsePlan`, `parseLedger`.
- Produces: CLI `node scripts/local-fixtures.ts [dossier]` (par défaut `fixtures-local/`).

Comportement :
- Sans dossier : affiche `fixtures-local/ absent, rien à tester` et sort avec le code 0.
- Sinon, parcourt récursivement le dossier :
  - Chaque fichier `progress*.md` est parsé. Toute ligne qui commence par `Task <n>:` suivi de `complete`, `fix round`, `minor`, `parked` ou `Ruling`, mais que `parseLedger` ne reconnaît pas, est un échec. Le message donne le fichier et le numéro de ligne, jamais le contenu (données client).
  - Chaque fichier situé sous un dossier `plans/` doit donner au moins une tâche avec `parsePlan`.
- Résumé : `<f> fichiers, <l> lignes reconnues, <e> échecs`. Code de sortie 1 s'il y a des échecs.

- [ ] **Step 1: Préparer une fixture locale de test**

Créer à la main `fixtures-local/sample/progress.md`, avec une ligne valide et une ligne `Task 4: complete commits manquants` (invalide). Ce dossier est gitignoré.

- [ ] **Step 2: Implémenter le script et vérifier qu'il signale la ligne invalide**

Run: `node scripts/local-fixtures.ts`
Expected : `1 échecs`, avec `fixtures-local/sample/progress.md:<ligne>`, code 1.

- [ ] **Step 3: Retirer la ligne invalide et relancer**

Run: `node scripts/local-fixtures.ts && npm run typecheck`
Expected : `0 échecs`, code 0.

- [ ] **Step 4: Commit**

```bash
git add scripts/local-fixtures.ts package.json
git commit -m "feat: local real-data fixture runner"
```

### Task 12: E2E local avec claude -p

**Files:**
- Create: `src/e2e.ts`, `scripts/e2e.sh`, `e2e/fixture/package.json`, `e2e/fixture/src/text.js`, `e2e/fixture/test/text.test.js`, `e2e/fixture/docs/superpowers/specs/2026-01-01-text-utils-design.md`, `e2e/fixture/docs/superpowers/plans/2026-01-01-text-utils.md`, `scripts/e2e-check.ts`
- Modify: `package.json` (script `e2e`), `README.md` (section tests)
- Test: `tests/e2e.test.ts`

**Interfaces:**
- Consumes: `TraceEntry` ; la trace écrite par le mod (Task 7) via `SP_STATUSBAR_TRACE`.
- Produces:
  - `checkTrace(entries: readonly TraceEntry[], mode: Mode, expectedTasks: number): string[]` (vide = OK) dans `src/e2e.ts` ;
  - `bash scripts/e2e.sh <dossier superpowers> [sdd|direct|all]`.

`checkTrace` vérifie, dans l'ordre d'apparition :
- les étapes `exec`, `final-review`, `finishing` apparaissent dans cet ordre ;
- `expectedTasks` tâches distinctes atteignent `done` ;
- en `sdd`, chaque tâche passe par `writing` puis `review` avant `done` ;
- en `direct`, chaque tâche passe par `verify` avant `done`, et au moins une tâche voit `red` puis `green` (preuve que l'instrumentation fonctionne) ;
- la dernière entrée a `waiting: 'finishing-menu'`.

Seuls l'ordre et la présence comptent, jamais le nombre exact d'events.

Fixture : une mini bibliothèque Node (`slugify`, `truncate`, `wordCount`) testée par `node --test`. La spec est courte. Le plan contient 3 tâches au format writing-plans de 7.0.0 (une fonction et ses tests par tâche). L'implémentation initiale est vide : les tâches la créent.

`scripts/e2e.sh` :
1. Copie `e2e/fixture` dans un dossier temporaire, `git init`, premier commit.
2. Lance, pour chaque mode demandé :
   ```
   SP_STATUSBAR_TRACE=<tmp>/trace-<mode>.jsonl claude -p \
     --plugin-dir <racine du dépôt> --plugin-dir <dossier superpowers> \
     --settings <fichier qui désactive les superpowers installés> \
     --permission-mode bypassPermissions \
     "<prompt>"
   ```
   Le fichier de settings met `false` pour chaque entrée `superpowers@…` de `enabledPlugins` lue dans `~/.claude/settings.json`, afin que seule la version testée soit chargée. Le script vérifie que le fichier est bien pris en compte : la trace doit contenir des events `skill`. Prompt :
   - `sdd` : `Execute the plan docs/superpowers/plans/2026-01-01-text-utils.md with superpowers:subagent-driven-development. Work on the current branch; do not create a worktree.`
   - `direct` : la même phrase avec `superpowers:executing-plans`.
3. Lance `node scripts/e2e-check.ts <trace> <mode> 3`. Ce script appelle `checkTrace`, affiche les problèmes et sort avec le code 1 s'il y en a.
4. Copie chaque trace dans `fixtures-local/e2e/<version>-<mode>-<date>.jsonl`.
5. Affiche `E2E <mode> : OK` ou la liste des problèmes. Code de sortie non nul en cas d'échec.

- [ ] **Step 1: Écrire les tests qui échouent**

`tests/e2e.test.ts` :
  - `checkTrace accepts a well-ordered SDD trace` (trace construite en rejouant `SDD_RUN` avec `detect` + `reduce` et une `traceEntry` par action) ;
  - `checkTrace reports a task that skipped review in sdd` ;
  - `checkTrace requires red then green in direct mode` ;
  - `checkTrace requires the final finishing-menu wait`.

- [ ] **Step 2: Lancer les tests et vérifier qu'ils échouent**

Run: `claude plugin test .`
Expected : FAIL.

- [ ] **Step 3: Implémenter `checkTrace`, `e2e-check.ts`, la fixture, `e2e.sh` et la section README**

Run: `claude plugin test . && npm run typecheck`
Expected : PASS.

- [ ] **Step 4: Lancer l'e2e réel sur 7.0.0**

Run: `bash scripts/e2e.sh ~/.claude/plugins/cache/superpowers-marketplace/superpowers/7.0.0 all`
Expected : `E2E sdd : OK` et `E2E direct : OK`. Cette étape coûte des tokens et prend plusieurs minutes. En cas d'échec, lire la trace : une règle de détection à corriger se corrige dans `sp-7.0.0.ts`, avec un test ajouté en Task 5.

- [ ] **Step 5: Commit**

```bash
git add src/e2e.ts scripts/e2e.sh scripts/e2e-check.ts e2e package.json README.md tests/e2e.test.ts
git commit -m "feat: local e2e harness with claude -p"
```
