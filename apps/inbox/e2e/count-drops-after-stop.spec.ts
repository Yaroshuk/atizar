import { test, expect } from './fixtures'
import { InboxBoard } from './pages/InboxBoard'

// EXPLORATORY (may be RED — probes count + routing AFTER a state change). Two live reply instances →
// stop ONE → the card count must drop 2 → 1, and opening the reply card now goes straight to the
// single live thread (no picker). Pins that the count and open-routing re-derive from the live set
// after a Stop, not from a stale snapshot.
test.describe('Count and routing update after stopping one of two instances', () => {
  test('2 active → stop one → 1 active → card opens the single live thread', async ({ page }) => {
    const board = new InboxBoard(page)

    await test.step('stage two reply instances', async () => {
      await board.stageReply('alice@example.com', 'cd-a')
      await board.stageReply('bob@example.com', 'cd-b')
      await board.open()
      await expect(board.agentCard('reply')).toContainText(/2 active/i, { timeout: 30_000 })
    })

    await test.step('open the picker and stop ONE instance', async () => {
      await board.agentCard('reply').click()
      await expect(board.pickerModal()).toBeVisible({ timeout: 30_000 })
      await board.pickerRow().first().click()
      await expect(board.instanceStop()).toBeVisible({ timeout: 30_000 })
      await board.instanceStop().click()
      await board.closeModalIfOpen()
    })

    await test.step('the card now reads 1 active', async () => {
      await expect(board.agentCard('reply')).toContainText(/1 active/i, { timeout: 30_000 })
      await expect(board.agentCard('reply')).not.toContainText(/2 active/i)
    })

    await test.step('opening the reply card goes to the single live thread (no picker)', async () => {
      await board.agentCard('reply').click()
      await expect(board.instanceModal()).toBeVisible({ timeout: 30_000 })
      await expect(board.pickerModal()).toHaveCount(0)
    })
  })
})
