import { test, expect } from './fixtures'
import { InboxBoard } from './pages/InboxBoard'

// Interaction SEQUENCE (not a single happy path): START the sorter → Stop all → START again. After
// the global brake, every instance recedes, the input card returns to its launchable idle state, and
// a fresh START re-scans. This is the kind of multi-step flow only the browser catches.
test.describe('START → Stop all → START again', () => {
  test('the global brake resets the board and a fresh START re-scans', async ({ page }) => {
    const board = new InboxBoard(page)

    await test.step('first START scans and dispatches', async () => {
      await board.open()
      await board.startSorter()
      await expect(board.sortHeadline()).toBeVisible({ timeout: 30_000 })
      await board.closeModalIfOpen()
      await expect(board.pipelineRow('reply').first()).toBeVisible()
    })

    await test.step('Stop all halts everything → the board clears, START returns', async () => {
      await expect(board.stopAll()).toBeEnabled()
      await board.stopAll().click()
      await expect(board.pipelineRow('reply')).toHaveCount(0, { timeout: 30_000 })
      await expect(board.startButton('sorter')).toBeVisible()
    })

    await test.step('a second START re-scans from a clean slate', async () => {
      await board.startSorter()
      await expect(board.sortHeadline()).toBeVisible({ timeout: 30_000 })
      await board.closeModalIfOpen()
      await expect(board.pipelineRow('reply').first()).toBeVisible()
    })
  })
})
