import { test as base, expect } from '@playwright/test'

// Shared fixture: every spec starts from a CLEAN demo slate. `/api/reset-all` retires every work
// item (outcome 'reset' / 'stopped'); since reset/stopped-active do NOT cover in dedup, the next
// sorter START re-surfaces all four cassette emails → fresh awaiting gates per test. Without this,
// a prior spec's done/handled sources would be deduped and the next scan would create no gate.
export const test = base.extend({
  page: async ({ page }, use) => {
    await page.request.post('/api/reset-all')
    await use(page)
  },
})

export { expect }
