import '@testing-library/jest-dom/vitest'
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { CardShell } from './CardShell.js'

describe('CardShell', () => {
  it('renders kicker, title, body and actions slots', () => {
    render(
      <CardShell
        kicker='New lead'
        title='Acme Corp wants a demo'
        actions={<button>Approve</button>}
      >
        <p>Body content here</p>
      </CardShell>
    )

    expect(screen.getByText('New lead')).toBeInTheDocument()
    expect(screen.getByText('Acme Corp wants a demo')).toBeInTheDocument()
    expect(screen.getByText('Body content here')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument()
  })

  it('applies the attention tone class on the root element', () => {
    const { container } = render(
      <CardShell tone='attention' title='Approve this action'>
        <p>Awaiting your call</p>
      </CardShell>
    )

    const root = container.firstElementChild
    expect(root?.className).toMatch(/attention/i)
  })

  it('does not render the attention class on the default tone', () => {
    const { container } = render(<CardShell title='Plain card'>Body</CardShell>)
    const root = container.firstElementChild
    expect(root?.className).not.toMatch(/attention/i)
  })
})
