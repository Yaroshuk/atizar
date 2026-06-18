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
  it('renders the atizar brand and a headline', () => {
    renderLanding()
    expect(screen.getAllByText('atizar').length).toBeGreaterThan(0)
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument()
  })

  it('links to the live demo and to the GitHub repo', () => {
    renderLanding()
    const toDemo = screen.getAllByRole('link', { name: /demo/i })
    expect(toDemo.some((a) => a.getAttribute('href') === '/demo')).toBe(true)
    const toGithub = screen.getAllByRole('link', { name: /github|setup guide|star on github/i })
    expect(
      toGithub.some((a) => (a.getAttribute('href') ?? '').includes('github.com/Yaroshuk/atizar'))
    ).toBe(true)
  })

  it('states the developer value props (code-level approval, two faces)', () => {
    renderLanding()
    expect(screen.getByText(/Approval is a guarantee, not a prompt/i)).toBeInTheDocument()
    expect(screen.getByText(/Node editors fail everyone/i)).toBeInTheDocument()
  })

  it('flags that the demo runs on pre-recorded steps', () => {
    renderLanding()
    expect(screen.getByText(/pre-recorded steps/i)).toBeInTheDocument()
  })
})
