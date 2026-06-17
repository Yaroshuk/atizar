import { test, expect } from './fixtures'
import { InboxBoard } from './pages/InboxBoard'

// Catalog §12 S2: a re-scan honestly accounts for work already done. Scan #1 dispatches all four
// emails (everything new). A second START re-reads the SAME inbox — every source is now covered
// (live/done), so the scan result reads "already handled" with 0 new. The numbers are
// framework-projected from the dispatch dedup (the model narrates, the app accounts), so they must
// reflect dedup — NOT a model re-count of the whole inbox (the original bug).
test.describe('Re-scan reports already-handled, not new', () => {
  test('a second scan over the same inbox reads already-handled', async ({ page }) => {
    const board = new InboxBoard(page)

    await test.step('scan #1: everything is new', async () => {
      await board.open()
      await board.startSorter()
      await expect(board.sortHeadline()).toBeVisible({ timeout: 30_000 })
      await expect(board.sortHeadline()).toContainText(/new/i)
      await board.closeModalIfOpen()
    })

    await test.step('scan #2: the same inbox is now already handled', async () => {
      await board.startSorter()
      await expect(board.sortHeadline()).toBeVisible({ timeout: 30_000 })
      await expect(board.sortHeadline()).toContainText(/already handled/i)
    })
  })
})
