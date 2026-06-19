import { test, expect } from './fixtures'
import { InboxBoard } from './pages/InboxBoard'

// EXPLORATORY (may be RED — lifecycle walk to find bugs). START the sorter → stop EACH dispatched
// child one by one (NOT Stop-all) → the input agent must persist as the launchable root: every child
// leaves the pipeline, but the sorter stays START-able and a fresh START re-scans. This exercises the
// granular per-instance Stop on workers while the input root survives.
const CHILDREN = ['reply', 'reader', 'spam', 'important'] as const

test.describe('Stopping children one-by-one keeps the input agent launchable', () => {
  test('after every child is stopped, the sorter still re-scans', async ({ page }) => {
    const board = new InboxBoard(page)

    await test.step('START scans and dispatches the four children', async () => {
      await board.open()
      await board.startSorter()
      await expect(board.sortHeadline()).toBeVisible({ timeout: 30_000 })
      await board.closeModalIfOpen()
      await expect(board.pipelineRow('reply').first()).toBeVisible()
    })

    for (const child of CHILDREN) {
      await test.step(`stop the ${child} instance(s) → ${child} leaves the pipeline`, async () => {
        // reply may have more than one instance (per-sender); stop every instance of this child.
        await board.stopAllInstances(child)
        await expect(board.pipelineRow(child)).toHaveCount(0, { timeout: 30_000 })
      })
    }

    await test.step('the input agent persists → START is available and re-scans', async () => {
      await expect(board.startButton('sorter')).toBeVisible({ timeout: 30_000 })
      await board.startSorter()
      await expect(board.sortHeadline()).toBeVisible({ timeout: 30_000 })
    })
  })
})
