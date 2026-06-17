import '@testing-library/jest-dom/vitest'
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AgentCard } from './AgentCard'

const base = {
  name: 'Reply agent',
  subtitle: 'Drafts replies',
  iconName: 'pen' as const,
  aggregateLabel: '',
  onStart: () => {},
  onOpen: () => {},
}

describe('AgentCard', () => {
  it('C7: a terminal stopped instance shows "Stopped", not "Done"', () => {
    render(<AgentCard {...base} status='done' outcome='stopped' canStart={false} />)
    expect(screen.getByText('Stopped')).toBeInTheDocument()
    expect(screen.queryByText('Done')).not.toBeInTheDocument()
  })

  it('C8: unhealthy creds disable START and surface the error line', () => {
    render(
      <AgentCard
        {...base}
        status='idle'
        canStart
        health={{ ok: false, error: 'Gmail not connected', hint: 'Click Connect in the header' }}
      />
    )
    expect(screen.getByRole('button', { name: 'START' })).toBeDisabled()
    expect(screen.getByText('Gmail not connected')).toBeInTheDocument()
  })

  it('C5/C8: healthy creds leave START enabled', () => {
    render(<AgentCard {...base} status='idle' canStart health={{ ok: true }} />)
    expect(screen.getByRole('button', { name: 'START' })).toBeEnabled()
  })

  it('a handoff-only worker shows "Runs from a handoff", no START', () => {
    render(<AgentCard {...base} status='idle' canStart={false} />)
    expect(screen.getByText('Runs from a handoff')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'START' })).not.toBeInTheDocument()
  })
})
