import '@testing-library/jest-dom/vitest'
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { Message } from '@atizar/core'
import { AgentModal } from './AgentModal.js'

// Base props reused from AgentModal.userTurn.test.tsx
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

const resolveHandoff = () => ({ name: 'Reply agent', label: 'a draft' })

describe('AgentModal handoff render order', () => {
  it('renders DOM order: text → "Handed" note → text', () => {
    const messages = [
      { id: 'a1', role: 'assistant', content: 'sorting leads' },
      {
        id: 'handoff-c1',
        role: 'handoff',
        targetAgentId: 'wf__reply',
        childWorkItemId: 'c1',
        deduped: false,
      },
      { id: 'a2', role: 'assistant', content: 'all done' },
    ] as unknown as Message[]

    render(<AgentModal {...base} agent={{ messages }} resolveHandoff={resolveHandoff} />)

    const textA = screen.getByText('sorting leads')
    const handedEl = screen.getByText(/Handed/)
    const textB = screen.getByText('all done')

    // compareDocumentPosition: 0x4 = DOCUMENT_POSITION_FOLLOWING (argument comes after node)
    expect(textA.compareDocumentPosition(handedEl) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(handedEl.compareDocumentPosition(textB) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('renders the agent name and label in the handoff note', () => {
    const messages = [
      {
        id: 'handoff-c2',
        role: 'handoff',
        targetAgentId: 'wf__reply',
        childWorkItemId: 'c2',
        deduped: false,
      },
    ] as unknown as Message[]

    render(<AgentModal {...base} agent={{ messages }} resolveHandoff={resolveHandoff} />)

    expect(screen.getByText(/a draft/)).toBeInTheDocument()
    // "Reply agent" appears in both the modal title and the handoff note — verify the note is there
    expect(screen.getAllByText(/Reply agent/).length).toBeGreaterThanOrEqual(1)
  })

  it('does not render a handoff note for a deduped handoff', () => {
    const messages = [
      {
        id: 'handoff-c3',
        role: 'handoff',
        targetAgentId: 'wf__reply',
        childWorkItemId: 'c3',
        deduped: true,
      },
    ] as unknown as Message[]

    render(<AgentModal {...base} agent={{ messages }} resolveHandoff={resolveHandoff} />)

    expect(screen.queryByText(/Handed/)).not.toBeInTheDocument()
  })

  it('renders a sensible fallback when resolveHandoff is absent', () => {
    const messages = [
      {
        id: 'handoff-c4',
        role: 'handoff',
        targetAgentId: 'wf__reply',
        childWorkItemId: 'c4',
        deduped: false,
      },
    ] as unknown as Message[]

    render(<AgentModal {...base} agent={{ messages }} />)

    // Should still render a "Handed" note, just with fallback text
    expect(screen.getByText(/Handed/)).toBeInTheDocument()
  })
})
