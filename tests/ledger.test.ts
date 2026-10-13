import { test, expect } from 'claude-code/testing'

import { parseLedger, decisionsOf } from '../src/ledger.ts'
import { SDD_LEDGER, DIRECT_LEDGER } from './fixtures/ledgers.ts'

test('parseLedger reads completion lines in both executors', () => {
  const sdd = parseLedger(SDD_LEDGER).filter(l => l.kind === 'complete')
  expect(sdd.map(l => l.task)).toEqual(['1', '2'])
  const direct = parseLedger(DIRECT_LEDGER).filter(l => l.kind === 'complete')
  expect(direct.length).toBe(2)
})

test('parseLedger reads fix rounds', () => {
  expect(parseLedger(SDD_LEDGER)).toContainEqual({ kind: 'fix-round', task: '2', round: 1 })
})

test('parseLedger reads parked, minor and rulings with em or plain dash', () => {
  const lines = parseLedger(SDD_LEDGER)
  expect(lines).toContainEqual({ kind: 'parked', task: '2', text: 'test de borne manquant — Ruling: hors périmètre' })
  expect(lines).toContainEqual({ kind: 'minor', task: '3', text: 'docblock incomplet' })
  expect(lines).toContainEqual({ kind: 'ruling', task: '3a', text: 'helper renommé - plus lisible' })
  expect(lines).toContainEqual({ kind: 'ruling', text: 'pas de worktree — conteneur monté sur le dossier — coût : branche dans le dossier principal' })
  expect(parseLedger(DIRECT_LEDGER)).toContainEqual({ kind: 'minor', text: 'nommage' })
})

test('parseLedger ignores free prose and tables', () => {
  expect(parseLedger(SDD_LEDGER).length).toBe(7)
  expect(parseLedger(DIRECT_LEDGER).length).toBe(3)
  expect(parseLedger('')).toEqual([])
})

test('decisionsOf keeps minor, parked and ruling in order', () => {
  const decisions = decisionsOf(parseLedger(SDD_LEDGER))
  expect(decisions.map(d => d.kind)).toEqual(['parked', 'minor', 'ruling', 'ruling'])
  expect(decisions[0]).toEqual({ kind: 'parked', task: '2', text: 'test de borne manquant — Ruling: hors périmètre' })
})
