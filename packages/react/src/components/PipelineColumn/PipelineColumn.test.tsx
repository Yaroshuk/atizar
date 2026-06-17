import '@testing-library/jest-dom/vitest'
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PipelineColumn } from './PipelineColumn'
import type { PInstance, PipelineBlock } from '../../pipelineModel'

let seq = 0
const inst = (over: Partial<PInstance> = {}): PInstance => {
  seq += 1
  return {
    localId: `loc-${seq}`,
    runtimeKey: 'wf__reply',
    agentId: 'wf__reply',
    key: `k-${seq}`,
    episodeSeq: 1,
    name: 'Reply',
    iconName: 'pen',
    label: '',
    status: 'running',
    outcome: 'running',
    isInput: false,
    ...over,
  }
}

describe('PipelineColumn', () => {
  it('P9: empty pipeline shows the placeholder', () => {
    render(<PipelineColumn blocks={[]} onOpen={() => {}} />)
    expect(screen.getByText(/No agent is running yet/)).toBeInTheDocument()
  })

  it('P10: a single instance with ≥2 runs shows the "· N" run-count badge', () => {
    const parent = inst({ name: 'Email Sorter', isInput: true })
    const r1 = inst({ label: 'alice' })
    const r2 = inst({ label: 'alice' })
    const block: PipelineBlock = {
      parent,
      groups: [
        {
          agentId: 'wf__reply',
          name: 'Reply',
          iconName: 'pen',
          instances: [{ agentId: 'wf__reply', key: 'alice', runs: [r1, r2], head: r1 }],
          queued: 0,
        },
      ],
    }
    render(<PipelineColumn blocks={[block]} onOpen={() => {}} />)
    expect(screen.getByText(/· 2/)).toBeInTheDocument()
  })

  it('P8: ≥2 instances of an agent render the mini-header ("N active") + "queued: N"', () => {
    const parent = inst({ name: 'Email Sorter', isInput: true })
    const a = inst({ label: 'alice' })
    const b = inst({ label: 'bob' })
    const block: PipelineBlock = {
      parent,
      groups: [
        {
          agentId: 'wf__reply',
          name: 'Reply',
          iconName: 'pen',
          instances: [
            { agentId: 'wf__reply', key: 'alice', runs: [a], head: a },
            { agentId: 'wf__reply', key: 'bob', runs: [b], head: b },
          ],
          queued: 1,
        },
      ],
    }
    render(<PipelineColumn blocks={[block]} onOpen={() => {}} />)
    expect(screen.getByText('2 active')).toBeInTheDocument()
    expect(screen.getByText('queued: 1')).toBeInTheDocument()
  })
})
