import { test, expect } from './fixtures'
import { InboxBoard } from './pages/InboxBoard'

// Covers catalog §4 R3 / §5 PK2: an agent with ≥2 live instances opens the instance PICKER (not a
// single thread), and the picker's "N active" count matches the live instances. Two reply instances
// are staged via the API (the demo cassette only dispatches one), then the reply card is opened.
test.describe('Instance picker (demo, staged)', () => {
  test('opening an agent with 2 live instances shows the picker with "2 active"', async ({
    page,
  }) => {
    const board = new InboxBoard(page)

    await test.step('stage two reply instances, then load the board', async () => {
      await board.stageReply('alice@example.com', 'staged-m1')
      await board.stageReply('bob@example.com', 'staged-m2')
      await board.open()
    })

    await test.step('opening the reply card routes to the picker (≥2 live)', async () => {
      // Wait for BOTH staged instances to be live first — otherwise a click while only one has
      // reached awaiting routes to the single thread (length 1), not the picker (a race).
      await expect(board.pipelineRow('reply')).toHaveCount(2, { timeout: 30_000 })
      await board.agentCard('reply').click()
      await expect(board.pickerModal()).toBeVisible({ timeout: 30_000 })
      await expect(board.pickerModal()).toContainText('2 active')
    })
  })
})
