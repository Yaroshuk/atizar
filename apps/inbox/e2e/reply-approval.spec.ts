import { test, expect } from './fixtures'
import { InboxBoard } from './pages/InboxBoard'

// Covers catalog §9 H1/H2: the reply worker reaches awaiting-approval, the draft is editable, and
// approving (Save draft) resolves the gate (the approval affordance disappears). Demo cassette →
// no real Gmail draft is created.
test.describe('Reply HITL approval (demo)', () => {
  test('reply awaits approval and Save draft resolves the gate', async ({ page }) => {
    const board = new InboxBoard(page)

    await test.step('start the sorter, then open the reply instance', async () => {
      await board.open()
      await board.startSorter()
      await expect(board.sortHeadline()).toBeVisible({ timeout: 30_000 })
      await board.closeModalIfOpen()
      await board.openInstance('reply')
    })

    await test.step('the approval dialog renders the editable draft', async () => {
      await expect(board.approvalBody()).toBeVisible({ timeout: 30_000 })
    })

    await test.step('edit the draft and approve → the gate closes', async () => {
      await board.approvalBody().fill('Hello — edited by the e2e test.')
      await board.approvalSave().click()
      await expect(board.approvalSave()).toHaveCount(0, { timeout: 30_000 })
    })
  })
})
