import { test, expect } from './fixtures'
import { InboxBoard } from './pages/InboxBoard'

// Catalog §2 C3: a worker whose only instances are terminal shows the descriptive idle card
// ("Runs from a handoff"), NOT a stale terminal status like "Done"/"Stopped".
test.describe('Worker card idle when only terminal', () => {
  test('after the only reply finishes, its card reads idle, not a stale status', async ({
    page,
  }) => {
    const board = new InboxBoard(page)

    await board.stageReply('idle@example.com', 'ci-m1')
    await board.open()
    await board.openInstance('reply')
    await board.approveOpenReply('done')
    await board.closeModalIfOpen()

    // No live instance left → the worker card is back to its descriptive idle state.
    await expect(board.agentCard('reply')).toContainText('Runs from a handoff', { timeout: 30_000 })
    await expect(board.agentCard('reply')).not.toContainText('Done')
  })
})
