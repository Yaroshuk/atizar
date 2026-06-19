import { test, expect } from './fixtures'
import { InboxBoard } from './pages/InboxBoard'

// EXPLORATORY (may be RED — lifecycle walk). Stopping ONE child must not touch its siblings: stop the
// reply instance → reply leaves the pipeline, but reader/spam/important stay live, and the sorter is
// still "Working" via its remaining live descendants. Single-responsibility lifecycle: a per-instance
// Stop cancels only that instance's runs.
test.describe('Stopping one child leaves its siblings live', () => {
  test('stopping reply removes only reply; reader/spam/important remain', async ({ page }) => {
    const board = new InboxBoard(page)

    await test.step('START dispatches all four children', async () => {
      await board.open()
      await board.startSorter()
      await expect(board.sortHeadline()).toBeVisible({ timeout: 30_000 })
      await board.closeModalIfOpen()
      await expect(board.pipelineRow('reply').first()).toBeVisible()
      await expect(board.pipelineRow('reader').first()).toBeVisible()
    })

    await test.step('stop ONLY the reply instance(s)', async () => {
      // The sorter may route more than one email to reply; stop every reply instance so the assertion
      // is about reply leaving entirely, independent of how many the cassette produces.
      await board.stopAllInstances('reply')
      await board.closeModalIfOpen()
    })

    await test.step('reply is gone; the siblings are untouched', async () => {
      await expect(board.pipelineRow('reply')).toHaveCount(0, { timeout: 30_000 })
      await expect(board.pipelineRow('reader').first()).toBeVisible()
      await expect(board.pipelineRow('spam').first()).toBeVisible()
      await expect(board.pipelineRow('important').first()).toBeVisible()
    })
  })
})
