import { test, expect } from './fixtures'
import { InboxBoard } from './pages/InboxBoard'

// Catalog §5 PK1: the picker lists ONLY live instances — a done/stopped/rejected one does NOT appear.
// Set up [1 done, 2 awaiting] for reply, then open the picker and assert it shows 2 rows, not 3.
test.describe('Picker lists only live instances', () => {
  test('a done instance does not appear among the picker rows', async ({ page }) => {
    const board = new InboxBoard(page)

    await test.step('one reply is approved (done)', async () => {
      await board.stageReply('done@example.com', 'pk-done')
      await board.open()
      await board.openInstance('reply')
      await board.approveOpenReply('done one')
      await board.closeModalIfOpen()
    })

    await test.step('two more replies are awaiting → open the picker', async () => {
      await board.stageReply('live-a@example.com', 'pk-a')
      await board.stageReply('live-b@example.com', 'pk-b')
      await board.agentCard('reply').click()
      await expect(board.pickerModal()).toBeVisible({ timeout: 30_000 })
    })

    await test.step('the picker shows only the 2 LIVE rows (the done one is excluded)', async () => {
      await expect(board.pickerRow()).toHaveCount(2)
    })
  })
})
