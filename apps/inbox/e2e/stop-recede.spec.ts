import { test, expect } from './fixtures'
import { InboxBoard } from './pages/InboxBoard'

// Catalog §6 T2: a `stopped` worker instance recedes (neutral) from the live pipeline once stopped.
test.describe('Stopped worker recedes', () => {
  test('stopping a live reply instance removes it from the pipeline', async ({ page }) => {
    const board = new InboxBoard(page)

    await board.stageReply('stop@example.com', 'st-m1')
    await board.open()
    await board.openInstance('reply')

    await expect(board.instanceStop()).toBeVisible({ timeout: 30_000 })
    await board.instanceStop().click()
    await board.closeModalIfOpen()

    await expect(board.pipelineRow('reply')).toHaveCount(0, { timeout: 30_000 })
  })
})
