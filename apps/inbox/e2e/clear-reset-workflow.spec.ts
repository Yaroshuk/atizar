import { test, expect } from './fixtures'
import { InboxBoard } from './pages/InboxBoard'

// The per-workflow Clear/Reset: a FULL wipe (stops active + clears finished, all → history) — distinct
// from Stop (which only halts active). It opens a confirm first (no surprise wipe). After confirming,
// the board clears and the input agent returns to its launchable idle state; a fresh START re-scans.
test.describe('Clear / Reset workflow', () => {
  test('Reset confirmed wipes the workflow; START returns and re-scans', async ({ page }) => {
    const board = new InboxBoard(page)

    await test.step('START scans and dispatches', async () => {
      await board.open()
      await board.startSorter()
      await expect(board.sortHeadline()).toBeVisible({ timeout: 30_000 })
      await board.closeModalIfOpen()
      await expect(board.pipelineRow('reply').first()).toBeVisible()
    })

    await test.step('Reset opens a confirm; confirming wipes the board', async () => {
      await board.resetWorkflow().click()
      await expect(board.confirmAction()).toBeVisible({ timeout: 30_000 })
      await board.confirmAction().click()
      await expect(board.pipelineRow('reply')).toHaveCount(0, { timeout: 30_000 })
      await expect(board.startButton('sorter')).toBeVisible()
    })

    await test.step('a fresh START re-scans from the clean slate', async () => {
      await board.startSorter()
      await expect(board.sortHeadline()).toBeVisible({ timeout: 30_000 })
    })
  })
})
