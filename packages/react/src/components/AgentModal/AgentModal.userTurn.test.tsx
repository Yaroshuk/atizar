import '@testing-library/jest-dom/vitest'
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { Message } from '@atizar/core'
import { AgentModal } from './AgentModal.js'

const base = {
  title: 'Reply agent',
  iconName: 'pen' as const,
  status: 'running' as const,
  renderToolCall: () => null,
  renderableToolNames: new Set<string>(),
  loading: false,
  canStart: false,
  intro: 'Drafting a reply…',
  notes: [],
  onStart: () => {},
  onClose: () => {},
}

describe('AgentModal incoming user-turn', () => {
  it('renders the incoming user message so the human sees what the agent reacted to', () => {
    const messages: Message[] = [
      { id: 'u1', role: 'user', content: 'Please draft a reply to lead@acme.com' },
      { id: 'a1', role: 'assistant', content: 'Here is a draft' },
    ]
    render(<AgentModal {...base} agent={{ messages }} />)
    expect(screen.getByText('Please draft a reply to lead@acme.com')).toBeInTheDocument()
    expect(screen.getByText('Here is a draft')).toBeInTheDocument()
  })

  it('does not crash when there is no user turn', () => {
    const messages: Message[] = [{ id: 'a1', role: 'assistant', content: 'Working' }]
    render(<AgentModal {...base} agent={{ messages }} />)
    expect(screen.getByText('Working')).toBeInTheDocument()
  })
})
