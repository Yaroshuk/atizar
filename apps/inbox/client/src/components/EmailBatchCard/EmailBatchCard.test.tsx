import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { EmailBatchCard } from './EmailBatchCard'

describe('EmailBatchCard', () => {
  it('emits the edited rows on approve', () => {
    const onApprove = vi.fn()
    render(
      <EmailBatchCard
        data={{
          items: [
            { messageId: 'a', from: 'x', subject: 's1', action: 'read' },
            { messageId: 'b', from: 'y', subject: 's2', action: 'read' },
          ],
        }}
        onApprove={onApprove}
        onReject={() => {}}
      />
    )
    // Each row exposes an icon-button cluster; pick the second row's Trash action by label.
    fireEvent.click(screen.getByRole('button', { name: /^trash — y$/i }))
    fireEvent.click(screen.getByRole('button', { name: /apply/i }))
    expect(onApprove).toHaveBeenCalledWith({
      items: [
        { messageId: 'a', from: 'x', subject: 's1', action: 'read' },
        { messageId: 'b', from: 'y', subject: 's2', action: 'trash' },
      ],
    })
  })

  it('reject calls onReject', () => {
    const onReject = vi.fn()
    render(
      <EmailBatchCard
        data={{ items: [{ messageId: 'a', from: 'x', subject: 's1', action: 'read' }] }}
        onApprove={() => {}}
        onReject={onReject}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /reject/i }))
    expect(onReject).toHaveBeenCalled()
  })
})
