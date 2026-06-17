import { test, expect } from './fixtures'
import { InboxBoard } from './pages/InboxBoard'

// EXPLORATORY (may be RED — probes the count source-of-truth). Two live reply instances (two senders)
// must read consistently across surfaces: the card counts "2 active" (C2), the pipeline groups TWO
// reply rows (P8), and opening the card routes to the picker (R3). The 1-vs-2 count mismatch was a
// real past bug — this pins all three reading from the same source.
test.describe('Two live instances: count, grouping, routing agree', () => {
  test('reply card reads 2 active, pipeline shows 2 rows, card opens the picker', async ({
    page,
  }) => {
    const board = new InboxBoard(page)

    await test.step('stage two reply instances (distinct senders)', async () => {
      await board.stageReply('alice@example.com', 'cc-a')
      await board.stageReply('bob@example.com', 'cc-b')
      await board.open()
    })

    await test.step('pipeline groups TWO reply rows (P8)', async () => {
      await expect(board.pipelineRow('reply')).toHaveCount(2, { timeout: 30_000 })
    })

    await test.step('the reply card counts 2 active (C2)', async () => {
      await expect(board.agentCard('reply')).toContainText(/2 active/i, { timeout: 30_000 })
    })

    await test.step('opening the reply card routes to the picker (R3)', async () => {
      await board.agentCard('reply').click()
      await expect(board.pickerModal()).toBeVisible({ timeout: 30_000 })
    })
  })
})
