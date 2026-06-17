import { test, expect } from './fixtures'
import { InboxBoard } from './pages/InboxBoard'

// Catalog §6 T1: a `done` worker instance recedes from the live pipeline once it has no live run.
// RED until terminal worker instances are dropped from the live lists; GREEN when they are.
test.describe('Terminal worker recedes', () => {
  test('an approved (done) reply instance leaves the pipeline', async ({ page }) => {
    const board = new InboxBoard(page)

    await board.stageReply('solo@example.com', 'rc-m1')
    await board.open()
    await board.openInstance('reply')
    await board.approveOpenReply('done')
    await board.closeModalIfOpen()

    // Once done with no live run, the worker instance should be gone from the live pipeline.
    await expect(board.pipelineRow('reply')).toHaveCount(0, { timeout: 30_000 })
  })
})
