import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { runMigrations, resetDb } from '@atizar/server'
import { runGolden } from './runner.js'
import { leadInboxScenarios } from './scenarios/lead-inbox.js'

beforeAll(async () => {
  await runMigrations()
})
beforeEach(async () => {
  await resetDb()
})

describe('lead-inbox golden set', () => {
  for (const scenario of leadInboxScenarios) {
    it(scenario.name, async () => {
      const facts = await runGolden(scenario)

      expect(facts.gates).toHaveLength(scenario.expect.gates?.length ?? 0)
      for (const exp of scenario.expect.gates ?? []) {
        const g = facts.gates.find((x) => x.toolName === exp.toolName)
        expect(g, `gate ${exp.toolName}`).toBeDefined()
        expect(g!.kind).toBe(exp.kind)
        for (const k of exp.formKeys) expect(g!.formKeys).toContain(k)
      }

      for (const exp of scenario.expect.effects ?? []) {
        const fired = facts.effects.filter((e) => e.toolName === exp.toolName)
        expect(fired, `effect ${exp.toolName} fired once`).toHaveLength(1)
      }
      if ((scenario.expect.effects ?? []).length === 0) {
        expect(facts.effects).toHaveLength(0)
      }

      for (const [agentId, status] of Object.entries(scenario.expect.finalStatuses ?? {})) {
        const item = facts.items.find((i) => i.agentId === agentId)
        expect(item, `item for ${agentId}`).toBeDefined()
        expect(item!.status).toBe(status)
      }
      for (const [agentId, resolution] of Object.entries(scenario.expect.resolutions ?? {})) {
        const item = facts.items.find((i) => i.agentId === agentId)
        expect(item, `item for ${agentId}`).toBeDefined()
        expect(item!.resolution).toBe(resolution)
      }
    })
  }
})
