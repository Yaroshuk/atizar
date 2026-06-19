import { test, expect } from './fixtures'
import { InboxBoard } from './pages/InboxBoard'

// EXPLORATORY (RED — pins a confirmed bug). After START + close, the sorter's last scan is reachable
// from the PIPELINE row (the instance opens) but NOT from the AGENT CARD (the card routes to an idle
// type-view) — so you cannot open the inbox from its card. The two open paths DIVERGE for the input
// agent: the pipeline shows it via `hasLiveDescendant` (children still live) and opens the instance,
// while card open-routing counts only `isLive(self)` — the done scan isn't "live" → type-view. Both
// paths MUST land on the same place. This spec asserts parity; red = the divergence.
test.describe('Input agent: pipeline-open and card-open reach the same scan', () => {
  test('opening the sorter from the card matches opening it from the pipeline', async ({
    page,
  }) => {
    const board = new InboxBoard(page)

    await test.step('START scans; close the auto-opened thread', async () => {
      await board.open()
      await board.startSorter()
      await expect(board.sortHeadline()).toBeVisible({ timeout: 30_000 })
      await board.closeModalIfOpen()
    })

    await test.step('PIPELINE open → the sorter instance (last scan) opens', async () => {
      await board.openInstance('sorter')
      await expect(board.sortHeadline()).toBeVisible({ timeout: 30_000 })
      await board.closeModalIfOpen()
    })

    await test.step('CARD open → MUST also reach the scan, not an idle type-view', async () => {
      await board.agentCard('sorter').click()
      await expect(board.instanceModal()).toBeVisible({ timeout: 30_000 })
      await expect(board.sortHeadline()).toBeVisible({ timeout: 30_000 })
      await expect(board.typeView()).toHaveCount(0) // ← RED today: card shows idle type-view
    })
  })
})
