import { describe, it, expect } from 'vitest'

describe('PGlite demo DB', () => {
  it('builds an in-memory drizzle db and migrate-on-boot creates the work_items table', async () => {
    process.env.DEMO = '1'
    const { db } = await import('./client.js')
    const { runMigrations } = await import('./migrate.js')
    await runMigrations()
    const rows = await db.query.workItems.findMany({ limit: 1 })
    expect(Array.isArray(rows)).toBe(true)
    delete process.env.DEMO
  })
})
