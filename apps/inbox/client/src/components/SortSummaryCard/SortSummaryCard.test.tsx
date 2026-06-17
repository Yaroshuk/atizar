import '@testing-library/jest-dom/vitest'
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('@atizar/react', async (orig) => ({
  ...(await orig<typeof import('@atizar/react')>()),
  useThreadHandoffs: () => [
    { targetAgentId: 'wf__important', childWorkItemId: 'c-imp', deduped: false },
    { targetAgentId: 'wf__reader', childWorkItemId: 'c-reader', deduped: true },
  ],
  useBoard: () => ({
    items: [
      { id: 'c-imp', payload: { emails: [{ messageId: 'i1' }] } },
      {
        id: 'c-reader',
        payload: {
          emails: [
            { messageId: 'r1' },
            { messageId: 'r2' },
            { messageId: 'r3' },
            { messageId: 'r4' },
          ],
        },
      },
    ],
  }),
}))

import { SortSummaryCard } from './SortSummaryCard.js'

describe('SortSummaryCard', () => {
  it('shows read / new / already-handled from the projected scan result', () => {
    render(<SortSummaryCard summary='Sorted your inbox.' />)
    expect(screen.getByText(/5 read/i)).toBeInTheDocument()
    expect(screen.getByText(/1 new/i)).toBeInTheDocument()
    expect(screen.getByText(/4 already handled/i)).toBeInTheDocument()
    expect(screen.getByText(/important: 1/i)).toBeInTheDocument() // new chip
    expect(screen.getByText(/reader: 4/i)).toBeInTheDocument() // handled row
  })
})
