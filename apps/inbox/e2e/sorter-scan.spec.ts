import { test, expect } from './fixtures'
import { InboxBoard } from './pages/InboxBoard'

// Covers catalog §3/§12: START runs the sorter (demo cassette), the app shows the INBOX SORTED
// card, and the scan has dispatched the four worker groups into the pipeline.
test.describe('Sorter scan (demo)', () => {
  test('START shows the INBOX SORTED card and dispatches the four worker groups', async ({
    page,
  }) => {
    const board = new InboxBoard(page)

    await test.step('open + start — the sorter thread auto-opens with the result card', async () => {
      await board.open()
      await board.startSorter()
      await expect(board.sortHeadline()).toBeVisible({ timeout: 30_000 })
      await expect(board.sortHeadline()).toContainText('read')
    })

    await test.step('the scan dispatched reply/reader/spam/important into the pipeline', async () => {
      await board.closeModalIfOpen()
      await expect(board.pipelineRow('reply').first()).toBeVisible()
      await expect(board.pipelineRow('reader').first()).toBeVisible()
      await expect(board.pipelineRow('spam').first()).toBeVisible()
      await expect(board.pipelineRow('important').first()).toBeVisible()
    })
  })
})
