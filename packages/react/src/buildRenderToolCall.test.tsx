import '@testing-library/jest-dom/vitest'
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { z } from 'zod'
import { buildRenderToolCall } from './buildRenderToolCall'
import { byWorkflow } from './registryScope'
import type { RenderSpec, DeliverFn } from './renderSpecs'
import type { ToolCall } from '@atizar/core'

const noopDeliver: DeliverFn = () => {}

// Two workflows register the SAME tool name with DIFFERENT components.
const specs: RenderSpec[] = [
  {
    workflowId: 'wf-a',
    toolName: 'renderCard',
    parameters: z.object({}),
    render: () => <div>From A</div>,
  },
  {
    workflowId: 'wf-b',
    toolName: 'renderCard',
    parameters: z.object({}),
    render: () => <div>From B</div>,
  },
]

const call = (name: string): ToolCall =>
  ({ id: 'tc1', function: { name, arguments: '{}' } }) as unknown as ToolCall

describe('buildRenderToolCall workflow scoping', () => {
  it('resolves the same tool name to each workflow component when fed the scoped list', () => {
    const renderA = buildRenderToolCall(byWorkflow(specs, 'wf-a'), noopDeliver)
    const { unmount } = render(<>{renderA({ toolCall: call('renderCard') })}</>)
    expect(screen.getByText('From A')).toBeInTheDocument()
    expect(screen.queryByText('From B')).not.toBeInTheDocument()
    unmount()

    const renderB = buildRenderToolCall(byWorkflow(specs, 'wf-b'), noopDeliver)
    render(<>{renderB({ toolCall: call('renderCard') })}</>)
    expect(screen.getByText('From B')).toBeInTheDocument()
    expect(screen.queryByText('From A')).not.toBeInTheDocument()
  })

  it('returns null for a tool not in the scoped list', () => {
    const renderA = buildRenderToolCall(byWorkflow(specs, 'wf-a'), noopDeliver)
    expect(renderA({ toolCall: call('renderOther') })).toBeNull()
  })
})
