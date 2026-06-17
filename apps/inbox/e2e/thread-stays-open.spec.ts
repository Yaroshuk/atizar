import { test, expect } from './fixtures'
import { InboxBoard } from './pages/InboxBoard'

// Catalog §8 TH2: when the last live run goes terminal while the instance thread is open, the modal
// STAYS open (no auto-close) — the human keeps reading the result; only the Stop affordance goes.
test.describe('Open thread stays open on terminal', () => {
  test('approving the draft does not auto-close the instance modal', async ({ page }) => {
    const board = new InboxBoard(page)

    await board.stageReply('stayopen@example.com', 'so-m1')
    await board.open()
    await board.openInstance('reply')
    await board.approveOpenReply('approved')

    // The run is now terminal/done, but the modal must still be open (no auto-close).
    await expect(board.instanceModal()).toBeVisible()
  })
})
