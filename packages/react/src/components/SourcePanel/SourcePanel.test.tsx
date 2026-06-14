import '@testing-library/jest-dom/vitest'
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SourcePanel } from './SourcePanel.js'

describe('SourcePanel', () => {
  it('renders an untrusted-content label so the human knows the source is not trusted', () => {
    render(<SourcePanel source={{ from: 'a@b.com', subject: 'Hi' }} />)
    expect(screen.getByText(/untrusted external content/i)).toBeInTheDocument()
  })

  it('renders each source field as a label/value pair', () => {
    render(<SourcePanel source={{ from: 'lead@acme.com', subject: 'Demo please' }} />)
    expect(screen.getByText('from')).toBeInTheDocument()
    expect(screen.getByText('lead@acme.com')).toBeInTheDocument()
    expect(screen.getByText('subject')).toBeInTheDocument()
    expect(screen.getByText('Demo please')).toBeInTheDocument()
  })

  it('stringifies a non-string value rather than crashing', () => {
    render(<SourcePanel source={{ count: 3, nested: { a: 1 } }} />)
    expect(screen.getByText('3')).toBeInTheDocument()
    expect(screen.getByText('{"a":1}')).toBeInTheDocument()
  })

  it('renders nothing when there are no fields', () => {
    const { container } = render(<SourcePanel source={{}} />)
    expect(container.firstChild).toBeNull()
  })

  it('hides internal plumbing keys (origin, threadId) from the human view', () => {
    render(
      <SourcePanel source={{ origin: 'lead-inbox__qualifier#1', threadId: 't1', from: 'x@y.z' }} />
    )
    expect(screen.queryByText('origin')).not.toBeInTheDocument()
    expect(screen.queryByText('threadId')).not.toBeInTheDocument()
    expect(screen.getByText('from')).toBeInTheDocument()
  })
})
