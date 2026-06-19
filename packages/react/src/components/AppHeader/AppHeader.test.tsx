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

describe('AppHeader brand', () => {
  it('renders the workspace initial as the mark when no logoSrc is given', () => {
    render(<AppHeader {...base} workspaceName='Acme Inbox' />)
    expect(screen.getByText('A')).toBeInTheDocument()
  })

  it('renders a logo image (not the letter) when logoSrc is given', () => {
    render(<AppHeader {...base} workspaceName='atizar' logoSrc='/atizar-orange.svg' />)
    const logo = screen.getByRole('img', { name: /atizar/i })
    expect(logo).toHaveAttribute('src', '/atizar-orange.svg')
    expect(screen.queryByText('a')).not.toBeInTheDocument() // letter fallback suppressed
    expect(screen.getByText('atizar')).toBeInTheDocument()
  })

  it('wraps the brand in a link to brandHref when given', () => {
    render(
      <AppHeader {...base} workspaceName='atizar' logoSrc='/atizar-orange.svg' brandHref='/' />
    )
    expect(screen.getByRole('link', { name: /atizar/i })).toHaveAttribute('href', '/')
  })
})

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
