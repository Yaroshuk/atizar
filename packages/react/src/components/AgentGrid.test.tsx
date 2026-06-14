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
        activeWorkflowId="a"
        aggOf={() => ({ status: 'idle' }) as any}
        healthOf={() => undefined}
        canStart={() => true}
        onStart={vi.fn()}
        onOpen={vi.fn()}
      />
    )
    expect(screen.getByText('REPLY AGENT')).toBeTruthy()
  })
})
