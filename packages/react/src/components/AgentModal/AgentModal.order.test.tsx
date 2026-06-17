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

    // "Reply agent" appears in both the modal title AND the handoff note, so query the note
    // element itself and assert it carries BOTH the resolved label and name (a trivial
    // getAllByText(/Reply agent/) would pass on the title alone).
    const note = screen.getByText(/Handed/)
    expect(note.textContent).toContain('a draft')
    expect(note.textContent).toContain('Reply agent')
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
