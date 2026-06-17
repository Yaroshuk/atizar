import { test, expect } from './fixtures'
import { InboxBoard } from './pages/InboxBoard'

// Covers catalog §1 P2 (awaiting instance shows in the pipeline with its status) and §2 C2 (the
// agent type card reflects the live aggregate) once the scan has dispatched its workers.
test.describe('Board state after a scan (demo)', () => {
  test('P2/C2: the reply worker shows as awaiting in the pipeline and on its card', async ({
    page,
  }) => {
    const board = new InboxBoard(page)
    await board.open()
    await board.startSorter()
    await expect(board.sortHeadline()).toBeVisible({ timeout: 30_000 })
    await board.closeModalIfOpen()

    await test.step('P2: the reply row in the pipeline reads awaiting approval', async () => {
      await expect(board.pipelineRow('reply').first()).toContainText('Approve')
    })

    await test.step('C2: the reply card surfaces its awaiting-approval aggregate', async () => {
      await expect(board.agentCard('reply')).toContainText('awaiting approval')
    })
  })
})
