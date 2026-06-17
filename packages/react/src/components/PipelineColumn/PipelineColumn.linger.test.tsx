import '@testing-library/jest-dom/vitest'
import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { PipelineColumn } from './PipelineColumn'
import type { PInstance, PipelineBlock } from '../../pipelineModel'

const inst = (over: Partial<PInstance>): PInstance => ({
  localId: 'x',
  runtimeKey: 'rk',
  agentId: 'wf__reply',
  key: 'k',
  episodeSeq: 1,
  name: 'Reply',
  iconName: 'mail',
  label: 'Ann',
  status: 'running',
  outcome: 'running',
  isInput: false,
  ...over,
})

const block = (parent: PInstance): PipelineBlock => ({ parent, groups: [] })

describe('PipelineColumn completion linger', () => {
  it('keeps a row mounted (lingering) the render after it drops out of blocks', () => {
    const a = inst({ localId: 'a', key: 'a', label: 'Ann' })
    const b = inst({ localId: 'b', key: 'b', label: 'Bob' })
    const { rerender, queryByText } = render(
      <PipelineColumn blocks={[block(a), block(b)]} onOpen={() => {}} />
    )
    expect(queryByText(/Ann/)).toBeTruthy()
    expect(queryByText(/Bob/)).toBeTruthy()

    // Bob's instance finished → buildPipeline drops it; the row must NOT vanish immediately.
    rerender(<PipelineColumn blocks={[block(a)]} onOpen={() => {}} />)
    expect(queryByText(/Ann/)).toBeTruthy()
    expect(queryByText(/Bob/)).toBeTruthy() // still mounted, lingering (will fade then unmount)
  })

  it('applies the leaving class to a lingering row', () => {
    const a = inst({ localId: 'a', key: 'a', label: 'Ann' })
    const b = inst({ localId: 'b', key: 'b', label: 'Bob' })
    const { rerender, queryByText } = render(
      <PipelineColumn blocks={[block(a), block(b)]} onOpen={() => {}} />
    )
    // After Bob drops out the element containing "Bob" must carry the leaving class.
    rerender(<PipelineColumn blocks={[block(a)]} onOpen={() => {}} />)
    const bobEl = queryByText(/Bob/)
    expect(bobEl).toBeTruthy()
    expect(bobEl?.closest('[class*="mini"]')).toBeTruthy()
    // The closest mini row element should have the leaving class in its className.
    const row = bobEl?.closest('[class*="mini"]') as HTMLElement | null
    expect(row?.className).toMatch(/leaving/)
  })
})
