import '@testing-library/jest-dom/vitest'
import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { AcknowledgeButton } from './AcknowledgeButton'

describe('AcknowledgeButton', () => {
  it('renders an OK affordance and fires onAcknowledge on click', () => {
    const onAcknowledge = vi.fn()
    render(<AcknowledgeButton onAcknowledge={onAcknowledge} />)
    fireEvent.click(screen.getByRole('button', { name: /ok|got it/i }))
    expect(onAcknowledge).toHaveBeenCalledTimes(1)
  })
})
