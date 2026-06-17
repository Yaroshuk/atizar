import { test, expect } from './fixtures'
import { InboxBoard } from './pages/InboxBoard'

// EXPLORATORY (may be RED — written to FIND a bug). The input agent (sorter) is the persistent root:
// after a scan its done run is the card's CURRENT CONTENT + the re-scan entry point. So reopening the
// sorter FROM ITS AGENT CARD should surface the last scan result (INBOX SORTED) again — NOT a blank
// type-view. If open-routing counts only isLive(self), the done scan is not "live" → the card routes
// to the type-view and the last scan disappears. This spec pins the DESIRED behavior; a red here is
// exactly that bug (input agent's last scan unreachable from its card).
test.describe('Input agent: reopen from the agent card after a scan', () => {
  test('reopening the sorter from its card still shows the last scan result', async ({ page }) => {
    const board = new InboxBoard(page)

    await test.step('START scans; close the auto-opened sorter thread', async () => {
      await board.open()
      await board.startSorter()
      await expect(board.sortHeadline()).toBeVisible({ timeout: 30_000 })
      await board.closeModalIfOpen()
    })

    await test.step('reopen the sorter from its agent card → the last scan is shown again', async () => {
      await expect(board.agentCard('sorter')).toBeVisible()
      await board.agentCard('sorter').click()
      await expect(board.instanceModal()).toBeVisible({ timeout: 30_000 })
      // The input agent's current content is its last scan — NOT an empty type-view.
      await expect(board.sortHeadline()).toBeVisible({ timeout: 30_000 })
      await expect(board.typeView()).toHaveCount(0)
    })
  })
})
