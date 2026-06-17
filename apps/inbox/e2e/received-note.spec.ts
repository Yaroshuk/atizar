import { test, expect } from './fixtures'
import { InboxBoard } from './pages/InboxBoard'

// Covers catalog §11 HO4: a child thread opens with a "← Received from <parent>" origin note at the
// top, so the human sees what handed work to this instance.
test.describe('Handoff received note (demo)', () => {
  test('the reply thread shows a "Received from" origin note', async ({ page }) => {
    const board = new InboxBoard(page)
    await board.open()
    await board.startSorter()
    await expect(board.sortHeadline()).toBeVisible({ timeout: 30_000 })
    await board.closeModalIfOpen()
    await board.openInstance('reply')

    await expect(board.receivedNote()).toBeVisible({ timeout: 30_000 })
    await expect(board.receivedNote()).toContainText('Received')
  })
})
