import { test, expect } from './fixtures'
import { InboxBoard } from './pages/InboxBoard'

// Covers catalog §11 HO3: a handoff note in the sorter thread carries an "Open <agent>" link that
// jumps to the dispatched child instance (cross-agent navigation), even after the child has run.
test.describe('Handoff open (demo)', () => {
  test('Open <reply> on the sorter handoff note jumps to the reply instance', async ({ page }) => {
    const board = new InboxBoard(page)

    await test.step('start the sorter — its thread auto-opens with handoff notes', async () => {
      await board.open()
      await board.startSorter()
      await expect(board.instanceModal()).toBeVisible({ timeout: 30_000 })
      await expect(board.handoffOpen('reply')).toBeVisible({ timeout: 30_000 })
    })

    await test.step('clicking Open reply jumps to the reply approval', async () => {
      await board.handoffOpen('reply').click()
      await expect(board.approvalBody()).toBeVisible({ timeout: 30_000 })
    })
  })
})
