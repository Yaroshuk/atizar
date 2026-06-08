import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { CopilotKit, useRenderToolCall } from '@copilotkit/react-core/v2'
import { useWorkflowRenders } from './useWorkflowRenders'

const messages = [
  {
    role: 'assistant',
    toolCalls: [
      {
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
      },
    ],
  },
]

function Surface({ deliver }: { deliver: (...args: any[]) => void }) {
  useWorkflowRenders(deliver)
  const renderToolCall = useRenderToolCall()
  const els = messages.flatMap((m: any) =>
    m.role === 'assistant' && Array.isArray(m.toolCalls)
      ? m.toolCalls.map((tc: any) => <div key={tc.id}>{renderToolCall({ toolCall: tc })}</div>)
      : []
  )
  return <div>{els}</div>
}

describe('renderVerdict generative-UI + handoff', () => {
  it('renders the VerdictCard and delivers to the reply agent on Draft reply', () => {
    const deliver = vi.fn()
    render(
      <CopilotKit runtimeUrl='/api/copilotkit'>
        <Surface deliver={deliver} />
      </CopilotKit>
    )
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
