import { test, expect } from './fixtures'
import { InboxBoard } from './pages/InboxBoard'

// EXPLORATORY (may be RED). The PER-WORKFLOW brake (Stop workflow) — distinct from the global Stop-all
// (start-stop-start.spec.ts) — must halt this workflow's tree: every instance recedes and the input
// card returns to its launchable idle state, so a fresh START re-scans.
test.describe('Stop workflow brake', () => {
  test('Stop workflow clears this workflow and START re-scans', async ({ page }) => {
    const board = new InboxBoard(page)

    await test.step('START scans and dispatches', async () => {
      await board.open()
      await board.startSorter()
      await expect(board.sortHeadline()).toBeVisible({ timeout: 30_000 })
      await board.closeModalIfOpen()
      await expect(board.pipelineRow('reply').first()).toBeVisible()
    })

    await test.step('Stop workflow halts the tree → the board clears, START returns', async () => {
      await expect(board.stopWorkflow()).toBeEnabled({ timeout: 30_000 })
      await board.stopWorkflow().click()
      // Bulk Stop is confirm-gated by design (useStopController) — confirm to actually halt.
      await board.confirmAction().click()
      await expect(board.pipelineRow('reply')).toHaveCount(0, { timeout: 30_000 })
      await expect(board.pipelineRow('reader')).toHaveCount(0)
      await expect(board.startButton('sorter')).toBeVisible()
    })

    await test.step('a fresh START re-scans', async () => {
      await board.startSorter()
      await expect(board.sortHeadline()).toBeVisible({ timeout: 30_000 })
    })
  })
})
