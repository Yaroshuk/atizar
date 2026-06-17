import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { InstanceView, type InstanceViewProps } from './InstanceView'

// RunView fetches a run's trace over hooks — stub it so the header is tested in isolation.
vi.mock('../RunView/RunView', () => ({ RunView: () => <div data-testid='runview' /> }))

const base: InstanceViewProps = {
  title: 'Reply agent',
  iconName: 'pen',
  status: 'running',
  description: 'Drafting a reply…',
  workflowId: 'wf',
  renderableToolNames: new Set<string>(),
  runs: [{ id: 'r1', notes: [] }],
  deliver: () => {},
  onStop: () => {},
  onClose: () => {},
}

describe('InstanceView header', () => {
  it('IW5: a multi-run instance shows the "N runs" badge and renders every run inline', () => {
    render(
      <InstanceView
        {...base}
        runs={[
          { id: 'r1', notes: [] },
          { id: 'r2', notes: [] },
        ]}
      />
    )
    expect(screen.getByText('2 runs')).toBeInTheDocument()
    expect(screen.getAllByTestId('runview')).toHaveLength(2)
  })

  it('IW7: Stop shows while live and is gone once terminal', () => {
    const { rerender } = render(<InstanceView {...base} status='running' />)
    expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument()
    rerender(<InstanceView {...base} status='done' outcome='done' />)
    expect(screen.queryByRole('button', { name: 'Stop' })).not.toBeInTheDocument()
  })

  it('IW8: a terminal stopped instance shows "Stopped" in the header, not "Done"', () => {
    render(<InstanceView {...base} status='done' outcome='stopped' />)
    expect(screen.getByText('Stopped')).toBeInTheDocument()
    expect(screen.queryByText('Done')).not.toBeInTheDocument()
  })
})
