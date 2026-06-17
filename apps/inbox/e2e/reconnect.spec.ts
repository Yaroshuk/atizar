import { test, expect } from './fixtures'
import { InboxBoard } from './pages/InboxBoard'

// Covers catalog §26 CX1: when the board SSE stream drops, the header shows a "Reconnecting…" chip
// so a frozen board never reads as live. We force the drop by aborting the board stream route.
test.describe('Board connection (demo)', () => {
  test('a dropped board stream surfaces the Reconnecting chip', async ({ page }) => {
    const board = new InboxBoard(page)

    // Fail every board SSE attempt → the EventSource errors → connection state goes 'reconnecting'.
    // The board SNAPSHOT (/api/board) still loads, so the page renders; only the live tail is down.
    await page.route('**/api/board/stream**', (route) => route.abort())

    await board.open()
    await expect(board.reconnectChip()).toBeVisible({ timeout: 15_000 })
  })
})
