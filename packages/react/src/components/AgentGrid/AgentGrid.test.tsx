import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AgentGrid } from './AgentGrid'

const agents = [{ id: 'reply', name: 'REPLY AGENT', maxInstances: 2 }] as any
const cfg: any = { meta: { reply: { subtitle: 'sub', iconName: 'inbox' } } }

describe('AgentGrid', () => {
  it('renders one card per agent', () => {
    render(
      <AgentGrid
        agents={agents}
        meta={cfg.meta}
        aggOf={() => ({ status: 'idle' }) as any}
        healthOf={() => undefined}
        canStart={() => true}
        onStart={vi.fn()}
        onOpen={vi.fn()}
      />
    )
    expect(screen.getByText('REPLY AGENT')).toBeTruthy()
  })

  describe('START disable is health-driven only (no more singletonBusy)', () => {
    const singletonAgents = [{ id: 'qualifier', name: 'QUALIFIER', maxInstances: 1 }] as any
    const singletonMeta: any = { qualifier: { subtitle: 'qualifies leads', iconName: 'inbox' } }

    // aggregateLabel returns '' when activeCount === 0, which lets AgentCard render the START button.
    const idleAgg: any = { activeCount: 0, awaitingCount: 0, status: 'idle' }

    // A busy singleton root no longer disables START — Start-over is reached via the live thread
    // (confirm-gated in useBoardNavigation), so the card's START stays enabled on health alone.
    it('does NOT disable START for a busy singleton (no "Already running")', () => {
      render(
        <AgentGrid
          agents={singletonAgents}
          meta={singletonMeta}
          aggOf={() => idleAgg}
          healthOf={() => undefined}
          canStart={() => true}
          onStart={vi.fn()}
          onOpen={vi.fn()}
        />
      )
      const btn = screen.getByRole('button', { name: /START/i })
      expect((btn as HTMLButtonElement).disabled).toBe(false)
      expect((btn as HTMLButtonElement).title).toBe('')
    })

    it('disables START only when credential health is not ok', () => {
      render(
        <AgentGrid
          agents={singletonAgents}
          meta={singletonMeta}
          aggOf={() => idleAgg}
          healthOf={() => ({ ok: false, error: 'No creds', hint: 'Connect Gmail' }) as any}
          canStart={() => true}
          onStart={vi.fn()}
          onOpen={vi.fn()}
        />
      )
      const btn = screen.getByRole('button', { name: /START/i })
      expect((btn as HTMLButtonElement).disabled).toBe(true)
      expect((btn as HTMLButtonElement).title).toBe('Connect Gmail')
    })
  })
})
