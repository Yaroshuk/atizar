import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ActivityPanel } from './ActivityPanel'
import type { ActivityEntry } from '../../serverTypes'
import type { ActivityFeed } from '../../hooks/useActivity'

const wf = [{ id: 'a', label: 'Email Inbox' }]

// useActivity appends oldest→newest, so `events[0]` is the OLDEST.
const events: ActivityEntry[] = [
  {
    ts: 1000,
    workflowId: 'a',
    agentId: 'a__sorter',
    workItemId: 'w1',
    kind: 'queued',
    summary: 'oldest event',
  },
  {
    ts: 2000,
    workflowId: 'a',
    agentId: 'a__sorter',
    workItemId: 'w1',
    kind: 'running',
    summary: 'middle event',
  },
  {
    ts: 3000,
    workflowId: 'a',
    agentId: 'a__sorter',
    workItemId: 'w1',
    kind: 'finished',
    summary: 'newest event',
  },
]

const feed = (overrides?: Partial<ActivityFeed>): ActivityFeed => ({
  events,
  connection: 'live',
  ...overrides,
})

describe('ActivityPanel — feed ordering', () => {
  it('renders newest event at the TOP in operator (activity) mode', () => {
    render(<ActivityPanel open dev={false} feed={feed()} workflows={wf} onClose={vi.fn()} />)
    const rendered = screen.getAllByText(/event$/).map((el) => el.textContent)
    expect(rendered).toEqual(['newest event', 'middle event', 'oldest event'])
  })

  it('keeps trace (dev) groups chronological — #1 is the oldest event', () => {
    render(<ActivityPanel open dev feed={feed()} workflows={wf} onClose={vi.fn()} />)
    // Switch to the dev Trace view.
    fireEvent.click(screen.getByRole('tab', { name: 'Trace' }))
    // The single group holds all three events; #1 must be the oldest.
    const seqs = screen.getAllByText(/^#\d+$/).map((el) => el.textContent)
    expect(seqs).toEqual(['#1', '#2', '#3'])
    const summaries = screen.getAllByText(/event$/).map((el) => el.textContent)
    expect(summaries).toEqual(['oldest event', 'middle event', 'newest event'])
  })
})
