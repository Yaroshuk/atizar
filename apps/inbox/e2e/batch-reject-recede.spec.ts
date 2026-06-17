import { test, expect } from './fixtures'
import { InboxBoard } from './pages/InboxBoard'

// A batch worker (reader/spam/important) rejected via its EmailBatchCard recedes from the live
// pipeline — symmetric with reply reject (reply-reject only covers the reply gate). Probes the batch
// reject path + that `rejected` recedes (neutral, not red).
test.describe('Batch reject recedes', () => {
  test('rejecting the reader batch removes it from the pipeline', async ({ page }) => {
    const board = new InboxBoard(page)

    await test.step('START dispatches the batch workers', async () => {
      await board.open()
      await board.startSorter()
      await expect(board.sortHeadline()).toBeVisible({ timeout: 30_000 })
      await board.closeModalIfOpen()
      await expect(board.pipelineRow('reader').first()).toBeVisible({ timeout: 30_000 })
    })

    await test.step('open the reader batch and reject it', async () => {
      await board.openInstance('reader')
      await expect(board.batchReject()).toBeVisible({ timeout: 30_000 })
      await board.batchReject().click()
      await board.closeModalIfOpen()
    })

    await test.step('the rejected batch recedes from the live pipeline', async () => {
      await expect(board.pipelineRow('reader')).toHaveCount(0, { timeout: 30_000 })
    })
  })
})
