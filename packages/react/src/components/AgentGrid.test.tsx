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
        items={[]}
        activeWorkflowId='a'
        aggOf={() => ({ status: 'idle' }) as any}
        healthOf={() => undefined}
        canStart={() => true}
        onStart={vi.fn()}
        onOpen={vi.fn()}
      />
    )
    expect(screen.getByText('REPLY AGENT')).toBeTruthy()
  })

  describe('singletonBusy', () => {
    const singletonAgents = [{ id: 'qualifier', name: 'QUALIFIER', maxInstances: 1 }] as any
    const singletonMeta: any = { qualifier: { subtitle: 'qualifies leads', iconName: 'inbox' } }

    // An active item that matches the singleton agent in workflow "a":
    // agentId = "a__qualifier" → slice(workflowId.length + 2) === "qualifier"
    const activeItem: any = {
      workflowId: 'a',
      agentId: 'a__qualifier',
      status: 'running',
    }

    // aggregateLabel returns '' when activeCount === 0, which lets AgentCard render the START button.
    const idleAgg: any = { activeCount: 0, awaitingCount: 0, status: 'idle' }

    it('disables START with title "Already running" when singleton has an active item', () => {
      render(
        <AgentGrid
          agents={singletonAgents}
          meta={singletonMeta}
          items={[activeItem]}
          activeWorkflowId='a'
          aggOf={() => idleAgg}
          healthOf={() => undefined}
          canStart={() => true}
          onStart={vi.fn()}
          onOpen={vi.fn()}
        />
      )
      const btn = screen.getByRole('button', { name: /START/i })
      expect((btn as HTMLButtonElement).disabled).toBe(true)
      expect((btn as HTMLButtonElement).title).toBe('Already running')
    })

    it('leaves START enabled when singleton item is finished (not in ACTIVE_SERVER)', () => {
      const finishedItem: any = { ...activeItem, status: 'finished' }
      render(
        <AgentGrid
          agents={singletonAgents}
          meta={singletonMeta}
          items={[finishedItem]}
          activeWorkflowId='a'
          aggOf={() => idleAgg}
          healthOf={() => undefined}
          canStart={() => true}
          onStart={vi.fn()}
          onOpen={vi.fn()}
        />
      )
      const btn = screen.getByRole('button', { name: /START/i })
      expect((btn as HTMLButtonElement).disabled).toBe(false)
    })
  })
})
