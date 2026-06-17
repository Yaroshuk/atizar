import { test, expect } from './fixtures'
import { InboxBoard } from './pages/InboxBoard'

// Catalog §4 R5 / §5 PK1: an agent with [1 live, 1 terminal] instance opens the SINGLE live thread,
// not the picker — counts are live-only, a terminal instance is not counted. RED until open-routing
// counts liveness (not raw instance count); GREEN when it does.
test.describe('Open-routing counts only live instances', () => {
  test('[1 live, 1 done] opens the single live thread, not the picker', async ({ page }) => {
    const board = new InboxBoard(page)

    await test.step('reply episode 1: approve → done', async () => {
      await board.stageReply('alice@example.com', 'rl-m1')
      await board.open()
      await board.openInstance('reply')
      await board.approveOpenReply('done one')
      await board.closeModalIfOpen()
    })

    await test.step('a second sender is now awaiting → exactly one LIVE reply instance', async () => {
      await board.stageReply('bob@example.com', 'rl-m2')
      await board.agentCard('reply').click()
    })

    await test.step('opening reply goes straight to the live thread (no picker)', async () => {
      await expect(board.instanceModal()).toBeVisible({ timeout: 30_000 })
      await expect(board.pickerModal()).toHaveCount(0)
    })
  })
})
