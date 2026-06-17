import '@testing-library/jest-dom/vitest'
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AppHeader } from './AppHeader'

const base = {
  workflows: [],
  activeId: '',
  unread: {},
  onSelect: () => {},
  globalActive: 0,
  stoppingAll: false,
  onStopAll: () => {},
  activityOpen: false,
  onToggleActivity: () => {},
  demo: true, // skip the live <Connections/> (its own test covers it) to isolate the header
}

describe('AppHeader board-connection chip (CX1)', () => {
  it('shows the "Reconnecting…" chip when the board SSE has dropped', () => {
    render(<AppHeader {...base} boardConnection='reconnecting' />)
    expect(screen.getByText(/Reconnecting/)).toBeInTheDocument()
  })

  it('shows no chip while the board stream is live', () => {
    render(<AppHeader {...base} boardConnection='live' />)
    expect(screen.queryByText(/Reconnecting/)).not.toBeInTheDocument()
  })
})
