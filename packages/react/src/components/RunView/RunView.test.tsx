import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { Message } from '@atizar/core'
import { ThreadItems } from '../AgentModal/ThreadItems'

// ThreadItems slot-wiring: the ackSlot prop surfaces for an error run and is absent otherwise.
// RunView computes ackSlot and passes it here — testing the slot at the ThreadItems level avoids
// the heavy hook-mocking that a full RunView mount would require.

const base = {
  messages: [] as Message[],
  renderToolCall: () => null,
  renderableToolNames: new Set<string>(),
  loading: false,
  notes: [],
}

describe('ThreadItems ackSlot wiring', () => {
  it('renders the ackSlot when provided (error run path)', () => {
    render(<ThreadItems {...base} ackSlot={<button>OK / Got it</button>} />)
    expect(screen.getByRole('button', { name: /ok|got it/i })).toBeInTheDocument()
  })

  it('does NOT render the ackSlot when undefined (non-error run path)', () => {
    render(<ThreadItems {...base} ackSlot={undefined} />)
    expect(screen.queryByRole('button', { name: /ok|got it/i })).not.toBeInTheDocument()
  })
})
