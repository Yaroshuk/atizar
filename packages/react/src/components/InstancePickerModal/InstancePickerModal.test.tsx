import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { InstancePickerModal, type PickerInstance } from './InstancePickerModal'

const instances: PickerInstance[] = [
  {
    localId: 'reply#1',
    label: 'Reply · alice',
    name: 'Reply',
    status: 'running',
    outcome: 'running',
  },
  {
    localId: 'reply#2',
    label: 'Reply · bob',
    name: 'Reply',
    status: 'awaiting_approval',
    outcome: 'running',
  },
  { localId: 'reply#3', label: 'Reply · carol', name: 'Reply', status: 'done', outcome: 'stopped' },
]

describe('InstancePickerModal', () => {
  it('PK2: the header "N active" counts only running/awaiting, not a terminal row', () => {
    render(
      <InstancePickerModal
        title='Reply agent'
        iconName='pen'
        instances={instances}
        onOpenInstance={() => {}}
        onClose={() => {}}
      />
    )
    // 3 rows shown, but only the running + awaiting ones are "active".
    expect(screen.getByText(/2 active/)).toBeInTheDocument()
    expect(screen.getByText('Reply · alice')).toBeInTheDocument()
    expect(screen.getByText('Reply · carol')).toBeInTheDocument()
  })

  it('shows the distinct terminal word (Stopped) on a finished row, not "Done"', () => {
    render(
      <InstancePickerModal
        title='Reply agent'
        iconName='pen'
        instances={instances}
        onOpenInstance={() => {}}
        onClose={() => {}}
      />
    )
    expect(screen.getByText('Stopped')).toBeInTheDocument()
    expect(screen.queryByText('Done')).not.toBeInTheDocument()
  })

  it('clicking an instance row opens that specific instance by localId', () => {
    const onOpenInstance = vi.fn()
    render(
      <InstancePickerModal
        title='Reply agent'
        iconName='pen'
        instances={instances}
        onOpenInstance={onOpenInstance}
        onClose={() => {}}
      />
    )
    fireEvent.click(screen.getByText('Reply · bob'))
    expect(onOpenInstance).toHaveBeenCalledWith('reply#2')
  })
})
