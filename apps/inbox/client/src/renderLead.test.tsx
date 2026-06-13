import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { ToolCall } from '@atizar/core'
import { buildRenderToolCall } from '@atizar/react'
import { leadInboxRenders } from '../../workflows/lead-inbox/client'

// renderLead is a pure display card (no handoff) — buildRenderToolCall parses the folded
// tool call and renders the LeadCard.
const toolCall = {
  id: 'tc_1',
  type: 'function',
  function: {
    name: 'renderLead',
    arguments: JSON.stringify({
      from: 'ivan@acme.ru',
      subject: 'Order: 10 units',
      summary: 'Customer wants to order 10 units; asks about delivery time.',
    }),
  },
} as unknown as ToolCall

describe('renderLead generative-UI mapping', () => {
  it('renders the LeadCard from a folded renderLead tool call', () => {
    const { container } = render(
      <div>{buildRenderToolCall(leadInboxRenders, () => {})({ toolCall })}</div>
    )
    expect(screen.getByText('Order: 10 units')).toBeInTheDocument()
    expect(screen.getByText(/ivan@acme\.ru/)).toBeInTheDocument()
    expect(container.querySelector('.lead-env')).toBeInTheDocument()
    expect(screen.getByText(/order 10 units/i)).toBeInTheDocument()
  })
})
