import { expect, type Locator, type Page } from '@playwright/test'
// Public package API, via the dedicated lightweight subpath — exactly what a real npm consumer
// would import. `@atizar/react/testIds` is a standalone entry (no UI/markdown/CSS), so importing it
// into the plain-Node test runner doesn't drag in browser-only code. (Rebuild @atizar/react after
// changing framework ids — same dist artifact npm ships.)
import { testIds } from '@atizar/react/testIds'
import { appTestIds } from '../../client/src/testIds'

// Page object for the inbox DEMO board. Locator methods RETURN a Locator (no actions, no
// assertions); action methods guard with web-first assertions. Selectors come ONLY from the shared
// catalogs. Pipeline rows + cards are keyed by the BARE agent id (e.g. 'reply', 'sorter').
export class InboxBoard {
  constructor(private readonly page: Page) {}

  // ── locators ──
  startButton(agentId: string): Locator {
    return this.page.getByTestId(testIds.agentStart(agentId))
  }
  pipelineRow(agentId: string): Locator {
    return this.page.getByTestId(testIds.pipelineRow(agentId))
  }
  agentCard(agentId: string): Locator {
    return this.page.getByTestId(testIds.agentCard(agentId))
  }
  instanceModal(): Locator {
    return this.page.getByTestId(testIds.instanceModal)
  }
  pickerModal(): Locator {
    return this.page.getByTestId(testIds.pickerModal)
  }
  typeView(): Locator {
    return this.page.getByTestId(testIds.typeView)
  }
  reconnectChip(): Locator {
    return this.page.getByTestId(testIds.reconnectChip)
  }
  receivedNote(): Locator {
    return this.page.getByTestId(testIds.receivedNote)
  }
  replyDraftCard(): Locator {
    return this.page.getByTestId(appTestIds.replyDraftCard)
  }
  instanceStop(): Locator {
    return this.page.getByTestId(testIds.instanceStop)
  }
  pickerRow(): Locator {
    return this.page.getByTestId(testIds.pickerRow)
  }
  stopAll(): Locator {
    return this.page.getByTestId(testIds.stopAll)
  }
  stopWorkflow(): Locator {
    return this.page.getByTestId(testIds.stopWorkflow)
  }
  resetWorkflow(): Locator {
    return this.page.getByTestId(testIds.resetWorkflow)
  }
  confirmAction(): Locator {
    return this.page.getByTestId(testIds.confirmAction)
  }

  async approveOpenReply(body = 'ok'): Promise<void> {
    await expect(this.approvalBody()).toBeVisible({ timeout: 30_000 })
    await this.approvalBody().fill(body)
    await this.approvalSave().click()
    await expect(this.approvalSave()).toHaveCount(0, { timeout: 30_000 })
  }
  modalClose(): Locator {
    return this.page.getByTestId(testIds.instanceClose)
  }
  handoffOpen(targetAgentId: string): Locator {
    return this.page.getByTestId(testIds.handoffOpen(targetAgentId))
  }
  sortHeadline(): Locator {
    return this.page.getByTestId(appTestIds.sortHeadline)
  }
  approvalBody(): Locator {
    return this.page.getByTestId(appTestIds.approvalBody)
  }
  approvalSave(): Locator {
    return this.page.getByTestId(appTestIds.approvalSave)
  }
  approvalReject(): Locator {
    return this.page.getByTestId(appTestIds.approvalReject)
  }
  batchApply(): Locator {
    return this.page.getByTestId(appTestIds.batchApply)
  }
  batchReject(): Locator {
    return this.page.getByTestId(appTestIds.batchReject)
  }
  batchAction(action: 'trash' | 'read' | 'star' | 'keep'): Locator {
    return this.page.getByTestId(appTestIds.batchAction(action))
  }

  // ── actions ──
  async open(): Promise<void> {
    await this.page.goto('/')
    await expect(this.startButton('sorter')).toBeVisible({ timeout: 20_000 })
  }

  // Stage a reply instance directly via the API (no sorter run) — used to set up multi-instance
  // scenarios the demo cassette doesn't produce on its own. Distinct `from` → distinct instance key;
  // distinct `messageId` → no dedup. Both replay the reply cassette to awaiting-approval.
  async stageReply(from: string, messageId: string): Promise<void> {
    const res = await this.page.request.post('/api/dispatch', {
      data: {
        agent: 'email-inbox__reply',
        payload: { email: { messageId, threadId: messageId, from, subject: 'staged' } },
      },
    })
    if (!res.ok()) throw new Error(`stageReply failed: ${res.status()}`)
  }

  // START an input agent. The app auto-opens the input instance's thread once the scan settles.
  async startSorter(): Promise<void> {
    const start = this.startButton('sorter')
    await expect(start).toBeEnabled() // demo creds are healthy → START is live
    await start.click()
  }

  async closeModalIfOpen(): Promise<void> {
    const close = this.modalClose().first()
    if (await close.isVisible().catch(() => false)) {
      await close.click()
      await expect(this.instanceModal()).toHaveCount(0, { timeout: 10_000 })
    }
  }

  // Open one instance's thread by clicking its pipeline row (bare agent id, e.g. 'reply').
  async openInstance(agentId: string): Promise<void> {
    const row = this.pipelineRow(agentId).first()
    await expect(row).toBeVisible({ timeout: 30_000 })
    await row.click()
    await expect(this.instanceModal()).toBeVisible()
  }

  // Stop EVERY live instance of an agent, one at a time, until none remain in the pipeline.
  // Data-independent: handles a single instance or N (e.g. the sorter routes two reply emails).
  async stopAllInstances(agentId: string): Promise<void> {
    for (;;) {
      const rows = this.pipelineRow(agentId)
      const n = await rows.count()
      if (n === 0) break
      await rows.first().click()
      await expect(this.instanceModal()).toBeVisible()
      await expect(this.instanceStop()).toBeVisible({ timeout: 30_000 })
      await this.instanceStop().click()
      await this.closeModalIfOpen()
      await expect(rows).toHaveCount(n - 1, { timeout: 30_000 })
    }
  }
}
