import { test, expect } from './fixtures'
import { InboxBoard } from './pages/InboxBoard'

// Catalog §6 T3: a `rejected` worker instance recedes from the live pipeline (neutral, not red) once
// it has no live run — same as a done one, just a different terminal outcome.
test.describe('Rejected worker recedes', () => {
  test('a rejected reply instance leaves the pipeline', async ({ page }) => {
    const board = new InboxBoard(page)

    await board.stageReply('reject@example.com', 'rj-m1')
    await board.open()
    await board.openInstance('reply')

    await expect(board.approvalReject()).toBeVisible({ timeout: 30_000 })
    await board.approvalReject().click()
    await expect(board.approvalReject()).toHaveCount(0, { timeout: 30_000 })
    await board.closeModalIfOpen()

    await expect(board.pipelineRow('reply')).toHaveCount(0, { timeout: 30_000 })
  })
})
