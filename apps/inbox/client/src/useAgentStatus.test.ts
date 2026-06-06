import { describe, it, expect } from 'vitest'
import { hasPendingApproval, type Message } from '../../core/messages'

// `hasPendingApproval` is the render-INDEPENDENT predicate that decides whether
// the AgentCard should show "Awaiting approval" (awaiting_approval). It reads
// `agent.messages` directly — the same shape the agent accumulates and the mock
// streams in (tool name at `toolCalls[].function.name`, id at `toolCalls[].id`;
// tool results as `{ role:"tool", toolCallId }`).
//
// This is the core of the bug fix: the closed card must reflect the pause
// without the ApprovalDialog (or modal) ever rendering, so this logic lives in
// pure message state, not in a render callback.
//
// The AG-UI `Message` type requires `id`, `content`, and `arguments` fields that
// are irrelevant to the predicate. We cast minimal stubs via `as unknown as
// Message` so we test only the logic that `hasPendingApproval` actually reads.

// Helper: cast a minimal stub to Message without satisfying every required field.
function msg<T extends object>(stub: T): Message {
  return stub as unknown as Message
}

const assistantText = (content: string): Message => msg({ role: 'assistant', content })

const confirmSendCall = (id: string): Message =>
  msg({
    role: 'assistant',
    toolCalls: [{ id, function: { name: 'confirmSend' } }],
  })

const renderLeadCall = (id: string): Message =>
  msg({
    role: 'assistant',
    toolCalls: [{ id, function: { name: 'renderLead' } }],
  })

const toolResult = (toolCallId: string): Message => msg({ role: 'tool', toolCallId })

describe('hasPendingApproval', () => {
  it('is TRUE when a confirmSend tool call has no matching tool message (run paused for human)', () => {
    const messages: Message[] = [
      assistantText('Checking inbox… found a lead.'),
      renderLeadCall('tc_lead'),
      confirmSendCall('tc_confirm'),
    ]
    expect(hasPendingApproval(messages, ['confirmSend'])).toBe(true)
  })

  it("is FALSE when the confirmSend tool call has a matching role:'tool' message (human approved)", () => {
    const messages: Message[] = [
      assistantText('Checking inbox… found a lead.'),
      renderLeadCall('tc_lead'),
      confirmSendCall('tc_confirm'),
      toolResult('tc_confirm'),
      assistantText('Done — reply sent.'),
    ]
    expect(hasPendingApproval(messages, ['confirmSend'])).toBe(false)
  })

  it('is FALSE when there is only a renderLead tool call (no confirmSend at all)', () => {
    const messages: Message[] = [
      assistantText('Checking inbox… found a lead.'),
      renderLeadCall('tc_lead'),
    ]
    expect(hasPendingApproval(messages, ['confirmSend'])).toBe(false)
  })

  it('is FALSE for an empty message list (idle / before first run)', () => {
    expect(hasPendingApproval([], ['confirmSend'])).toBe(false)
  })

  it("matches the approval by toolCallId, not by the tool message's name (AG-UI strips it)", () => {
    // A tool result answering a DIFFERENT call must not count as resolving the
    // pending confirmSend.
    const messages: Message[] = [confirmSendCall('tc_confirm'), toolResult('tc_other')]
    expect(hasPendingApproval(messages, ['confirmSend'])).toBe(true)
  })
})
