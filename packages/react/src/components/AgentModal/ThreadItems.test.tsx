import '@testing-library/jest-dom/vitest'
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { Message } from '@atizar/core'
import { ThreadItems } from './ThreadItems.js'

// A single assistant tool call whose tool name IS renderable (so buildThreadItems keeps it),
// letting us drive what renderToolCall returns.
const toolCallMsg = [
  {
    id: 'a1',
    role: 'assistant',
    content: '',
    toolCalls: [{ id: 'tc1', function: { name: 'route_emails', arguments: '{}' } }],
  },
] as unknown as Message[]

const base = {
  messages: toolCallMsg,
  renderableToolNames: new Set<string>(['route_emails']),
  loading: false,
  notes: [],
}

describe('ThreadItems tool-call rendering', () => {
  it('renders NO wrapper element when renderToolCall returns null (no empty thread-item / no gap)', () => {
    const { container } = render(<ThreadItems {...base} renderToolCall={() => null} />)
    // A tool with no card (e.g. a dispatch tool like route_emails) renders null — it must NOT
    // leave an empty wrapper div behind, which would still consume the thread's flex `gap`.
    expect(container.querySelectorAll('div')).toHaveLength(0)
  })

  it('renders the card wrapped when renderToolCall returns a node', () => {
    render(<ThreadItems {...base} renderToolCall={() => <div>CARD</div>} />)
    expect(screen.getByText('CARD')).toBeInTheDocument()
  })
})
