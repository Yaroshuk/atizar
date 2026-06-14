import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { ToolCall } from '@atizar/core'
import { buildRenderToolCall, byWorkflow } from '@atizar/react'
import { leadInboxRenders } from '../../workflows/lead-inbox/client'
import type { RenderSpec } from '@atizar/react'

// Stamp the workflowId so buildRenderToolCall receives a fully-typed RenderSpec[] (WS2).
const scopedLeadRenders = byWorkflow(
  leadInboxRenders.map((s) => ({ ...s, workflowId: 'lead-inbox' }) as RenderSpec),
  'lead-inbox'
)

// The new (CopilotKit-free) render path: buildRenderToolCall(deliver) parses a folded tool
// call's args and dispatches to the matching render spec; the card's action invokes deliver.
const toolCall = {
  id: 'tc_v',
  type: 'function',
  function: {
    name: 'renderVerdict',
    arguments: JSON.stringify({
      origin: 'lead-inbox',
      threadId: 't_9',
      from: 'ivan@acme.ru',
      subject: 'Order: 10 units',
      summary: 'Wants 10 units.',
      category: 'sales',
      priority: 'hot',
      reason: 'Ready-to-buy intent.',
    }),
  },
} as unknown as ToolCall

describe('renderVerdict generative-UI + handoff', () => {
  it('renders the VerdictCard and delivers to the reply agent on Draft reply', () => {
    const deliver = vi.fn()
    const node = buildRenderToolCall(scopedLeadRenders, deliver)({ toolCall })
    render(<div>{node}</div>)
    expect(screen.getByText('Order: 10 units')).toBeInTheDocument()
    expect(screen.getByText('sales')).toBeInTheDocument()
    expect(screen.getByText('hot')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Draft reply'))
    expect(deliver).toHaveBeenCalledWith(
      'lead-inbox',
      { kind: 'agent', agentId: 'reply' },
      expect.objectContaining({ threadId: 't_9', category: 'sales', priority: 'hot' })
    )
  })
})
