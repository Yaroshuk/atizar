import { test, expect } from './fixtures'
import { InboxBoard } from './pages/InboxBoard'

// Covers catalog §9 H3: rejecting the reply draft resolves the gate (no Gmail mutation). The
// approval affordance disappears once the run settles rejected.
test.describe('Reply HITL reject (demo)', () => {
  test('Reject resolves the gate with no draft', async ({ page }) => {
    const board = new InboxBoard(page)

    await test.step('start the sorter, then open the reply instance', async () => {
      await board.open()
      await board.startSorter()
      await expect(board.sortHeadline()).toBeVisible({ timeout: 30_000 })
      await board.closeModalIfOpen()
      await board.openInstance('reply')
    })

    await test.step('Reject closes the gate', async () => {
      await expect(board.approvalReject()).toBeVisible({ timeout: 30_000 })
      await board.approvalReject().click()
      await expect(board.approvalReject()).toHaveCount(0, { timeout: 30_000 })
    })
  })
})
