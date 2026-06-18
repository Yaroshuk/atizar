import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { Landing } from './Landing.js'

const renderLanding = () =>
  render(
    <MemoryRouter>
      <Landing />
    </MemoryRouter>
  )

describe('Landing', () => {
  it('renders the brand, a headline, and a primary Open-demo link to /demo', () => {
    renderLanding()
    expect(screen.getByText('atizar')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument()
    const cta = screen.getByRole('link', { name: /^open demo$/i })
    expect(cta).toHaveAttribute('href', '/demo')
  })

  it('lists the headline features (human-in-the-loop, safety)', () => {
    renderLanding()
    expect(screen.getByText(/human-in-the-loop by design/i)).toBeInTheDocument()
    expect(screen.getByText(/safe by design/i)).toBeInTheDocument()
  })
})
