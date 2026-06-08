import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { CopilotKit, useRenderToolCall } from '@copilotkit/react-core/v2'
import { useWorkflowRenders } from './useWorkflowRenders'

const messages = [
  {
    role: 'assistant',
    content: 'Checking inbox… found a lead.',
  },
  {
    role: 'assistant',
    toolCalls: [
      {
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
      },
    ],
  },
]

// Mirror of the real render surface: register the renderers, then map over assistant
// messages and call renderToolCall({ toolCall }) per tool call. deliver is a no-op here
// (renderLead has no handoff).
function ToolCallSurface() {
  useWorkflowRenders(() => {})
  const renderToolCall = useRenderToolCall()
  const els = messages.flatMap((msg: any) =>
    msg.role === 'assistant' && Array.isArray(msg.toolCalls)
      ? msg.toolCalls.map((toolCall: any) => (
          <div key={toolCall.id}>{renderToolCall({ toolCall })}</div>
        ))
      : []
  )
  return <div>{els}</div>
}

describe('renderLead generative-UI mapping', () => {
  it('renders the LeadCard from a streamed renderLead tool call in agent.messages', () => {
    const { container } = render(
      <CopilotKit runtimeUrl='/api/copilotkit'>
        <ToolCallSurface />
      </CopilotKit>
    )
    expect(screen.getByText('Order: 10 units')).toBeInTheDocument()
    expect(screen.getByText(/ivan@acme\.ru/)).toBeInTheDocument()
    expect(container.querySelector('.lead-env')).toBeInTheDocument()
    expect(screen.getByText(/order 10 units/i)).toBeInTheDocument()
  })
})
