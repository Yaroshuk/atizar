import { test, expect } from './fixtures'
import { InboxBoard } from './pages/InboxBoard'

// Covers catalog §9 H5: a batch worker (reader) reaches awaiting-approval, the EmailBatchCard
// renders its rows + "Apply N action(s)", and approving resolves the gate. Demo cassette → no Gmail.
test.describe('Batch HITL approval (demo)', () => {
  test('reader batch awaits approval and Apply resolves the gate', async ({ page }) => {
    const board = new InboxBoard(page)

    await test.step('start the sorter, then open the reader instance', async () => {
      await board.open()
      await board.startSorter()
      await expect(board.sortHeadline()).toBeVisible({ timeout: 30_000 })
      await board.closeModalIfOpen()
      await board.openInstance('reader')
    })

    await test.step('the batch card renders and Apply resolves the gate', async () => {
      await expect(board.batchApply()).toBeVisible({ timeout: 30_000 })
      await board.batchApply().click()
      await expect(board.batchApply()).toHaveCount(0, { timeout: 30_000 })
    })
  })

  test('WB3: toggling a row to keep drops the Apply count', async ({ page }) => {
    const board = new InboxBoard(page)
    await board.open()
    await board.startSorter()
    await expect(board.sortHeadline()).toBeVisible({ timeout: 30_000 })
    await board.closeModalIfOpen()
    await board.openInstance('reader')

    await expect(board.batchApply()).toBeVisible({ timeout: 30_000 })
    // reader defaults every row to 'read' (non-keep) → the count equals the row count.
    await expect(board.batchApply()).toContainText('Apply 1 action(s)')
    await board.batchAction('keep').first().click()
    await expect(board.batchApply()).toContainText('Apply 0 action(s)')
  })
})
