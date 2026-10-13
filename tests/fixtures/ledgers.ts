export const SDD_LEDGER = `# SDD ledger — plan: docs/superpowers/plans/2026-01-01-recettes.md

Projet fictif : une bibliothèque de recettes de cuisine.
Le plan compte trois tâches ; la troisième a une suite (3a).

| Pre-flight | Résultat |
|------------|----------|
| Tests verts | oui |
| Interfaces partagées | Recette, Ingredient |

Task 1: complete (commits a1b2c3d..e4f5a6b, review clean)
Task 2: fix round 1/5 (2 addressed, 0 open; commits e4f5a6b..0a1b2c3)
Task 2: complete (commits e4f5a6b..9f8e7d6c, 1 parked)
Task 2: parked — test de borne manquant — Ruling: hors périmètre
Task 3: minor (deferred): docblock incomplet
Task 3a: Ruling: helper renommé - plus lisible
Ruling: pas de worktree — conteneur monté sur le dossier — coût : branche dans le dossier principal
`

export const DIRECT_LEDGER = `Pre-flight: no shared interfaces
Task 1: complete (commits a1b2c3d..e4f5a6b, tests: npm test → 12 passing)
Task 2: complete (commits e4f5a6b..0a1b2c3, tests: npm test → 12 passing)
Final review: self-review (no subagent tool)
Final: minor (deferred): nommage
`
