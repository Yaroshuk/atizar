import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { CopilotKit, useRenderToolCall } from '@copilotkit/react-core/v2'
import { useInboxActions } from './actions'

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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function Surface({ onHandoff }: { onHandoff: (t: string, p: any) => void }) {
  useInboxActions(onHandoff)
  const renderToolCall = useRenderToolCall()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const els = messages.flatMap((m: any) =>
    m.role === 'assistant' && Array.isArray(m.toolCalls)
      ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
        m.toolCalls.map((tc: any) => <div key={tc.id}>{renderToolCall({ toolCall: tc })}</div>)
      : []
  )
  return <div>{els}</div>
}

describe('renderVerdict generative-UI + handoff', () => {
  it('renders the VerdictCard and hands off on Draft reply', () => {
    const onHandoff = vi.fn()
    render(
      <CopilotKit runtimeUrl='/api/copilotkit'>
        <Surface onHandoff={onHandoff} />
      </CopilotKit>
    )
    expect(screen.getByText('Order: 10 units')).toBeInTheDocument()
    expect(screen.getByText('sales')).toBeInTheDocument()
    expect(screen.getByText('hot')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Draft reply'))
    expect(onHandoff).toHaveBeenCalledWith(
      'reply',
      expect.objectContaining({ threadId: 't_9', category: 'sales', priority: 'hot' })
    )
  })
})
