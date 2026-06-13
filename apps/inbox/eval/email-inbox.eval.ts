import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { runMigrations, resetDb } from '@atizar/server'
import { runGolden } from './runner.js'
import { emailInboxScenarios } from './scenarios/email-inbox.js'

beforeAll(async () => {
  await runMigrations()
})
beforeEach(async () => {
  await resetDb()
})

describe('email-inbox golden set', () => {
  for (const scenario of emailInboxScenarios) {
    it(scenario.name, async () => {
      const facts = await runGolden(scenario)

      // CONTAINS (not equals) — the fan-out opens one gate per batch agent. Assert at least the
      // expected number opened first, so a "no gate at all" regression can't pass vacuously.
      expect(facts.gates.length).toBeGreaterThanOrEqual(scenario.expect.gates?.length ?? 0)
      for (const exp of scenario.expect.gates ?? []) {
        const g = facts.gates.find((x) => x.toolName === exp.toolName)
        expect(g, `gate ${exp.toolName}`).toBeDefined()
        expect(g!.kind).toBe(exp.kind)
        for (const k of exp.formKeys) expect(g!.formKeys).toContain(k)
      }
      for (const exp of scenario.expect.effects ?? []) {
        expect(
          facts.effects.filter((e) => e.toolName === exp.toolName).length
        ).toBeGreaterThanOrEqual(1)
      }
      for (const [agentId, status] of Object.entries(scenario.expect.finalStatuses ?? {})) {
        const item = facts.items.find((i) => i.agentId === agentId)
        expect(item, `item for ${agentId}`).toBeDefined()
        expect(item!.status).toBe(status)
      }
      // The sorter machine-dispatched children: at least one child item exists.
      const sorterId = facts.items.find((i) => i.agentId === 'email-inbox__sorter')?.id
      expect(facts.items.some((i) => i.parentId === sorterId)).toBe(true)
    })
  }
})
