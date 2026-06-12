import { describe, it, expect } from 'vitest'

describe('PGlite demo DB', () => {
  it('builds an in-memory drizzle db and migrate-on-boot creates the work_items table', async () => {
    // DEMO=1 MUST be set before the FIRST import of client.ts in this worker: client.ts selects
    // its driver once at module-evaluation (top-level await), so a cached import would skip PGlite.
    // Keep this test standalone — do not add a second case here that imports client.ts without DEMO.
    process.env.DEMO = '1'
    const { db } = await import('./client.js')
    const { runMigrations } = await import('./migrate.js')
    await runMigrations()
    const rows = await db.query.workItems.findMany({ limit: 1 })
    expect(Array.isArray(rows)).toBe(true)
    delete process.env.DEMO
  })
})
