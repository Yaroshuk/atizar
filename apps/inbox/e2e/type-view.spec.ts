import { test, expect } from './fixtures'
import { InboxBoard } from './pages/InboxBoard'

// Covers catalog §4 R1: opening an agent with NO live instances shows the descriptive TYPE-view
// (intro + START/handoff), not a dead thread and not the picker.
test.describe('Open-routing: type-view (demo)', () => {
  test('opening an agent with 0 live instances shows the type-view, not a thread/picker', async ({
    page,
  }) => {
    const board = new InboxBoard(page)
    await board.open() // fresh slate (reset fixture) → no live instances

    await board.agentCard('reply').click()
    await expect(board.typeView()).toBeVisible({ timeout: 10_000 })
    await expect(board.instanceModal()).toHaveCount(0)
    await expect(board.pickerModal()).toHaveCount(0)
  })
})
