import { test, expect } from './fixtures'
import { InboxBoard } from './pages/InboxBoard'

// TDD acceptance — desired behaviour that is NOT built yet, so this test is RED now and turns GREEN
// when episode-scoping lands. The red IS the point: it marks the feature as not-yet-done.
//
// Episode-scoping: a reply instance (keyed by sender) accumulates a Run per email it drafts for that
// sender. Today opening the instance shows EVERY run inline — so a prior, already-approved (done)
// draft from an earlier episode is resurrected next to the fresh one. Target: an opened thread shows
// ONLY the latest episode's run(s).
test.describe('Episode scoping', () => {
  test("reply does not resurrect a prior episode's done draft", async ({ page }) => {
    const board = new InboxBoard(page)
    const sender = 'episode-x@example.com'

    await test.step('episode 1: draft → approve → done', async () => {
      await board.stageReply(sender, 'ep1-m1')
      await board.open()
      await board.openInstance('reply')
      await board.approveOpenReply('episode 1 reply')
      await board.closeModalIfOpen()
    })

    await test.step('episode 2: a fresh email from the SAME sender → a new reply run', async () => {
      await board.stageReply(sender, 'ep2-m2')
      await board.openInstance('reply')
    })

    await test.step('the opened thread shows ONLY the latest episode (1 draft card)', async () => {
      // RED today: the done episode-1 draft lingers → 2 cards. GREEN after episode-scoping → 1.
      await expect(board.replyDraftCard()).toHaveCount(1, { timeout: 30_000 })
    })
  })
})
