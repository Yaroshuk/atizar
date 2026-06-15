import clsx from 'clsx'
import type { Status } from '../../status'
import { TINT, STATE_WORD } from '../../statusDisplay'
import { useDismiss } from '../../hooks/useDismiss'
import { Icon, type IconName } from '../Icon/Icon'
import s from './InstancePickerModal.module.scss'

// When an agent is running more than one instance (e.g. several reply copies), opening
// it shows THIS picker — a card per live instance — instead of one instance's thread.
// Clicking a card opens that specific instance (its own thread / approval dialog).
export type PickerInstance = {
  localId: string
  label: string
  name: string
  status: Status
}

type InstancePickerModalProps = {
  title: string
  iconName: IconName
  instances: PickerInstance[]
  onOpenInstance: (localId: string) => void
  onClose: () => void
}

export const InstancePickerModal = ({
  title,
  iconName,
  instances,
  onOpenInstance,
  onClose,
}: InstancePickerModalProps) => {
  const { closing, dismiss } = useDismiss(onClose)
  // "Live" = instances actually occupying the human (running / awaiting approval); a finished/kept
  // result is shown but is NOT counted as active, so the header reads "2 active" honestly instead
  // of the raw list length.
  const liveCount = instances.filter(
    (i) => i.status === 'running' || i.status === 'awaiting_approval'
  ).length
  return (
    <div className={clsx('backdrop', closing && 'closing')} onClick={dismiss}>
      <div className='modal' onClick={(e) => e.stopPropagation()}>
        <div className='modal-head'>
          <span className='modal-mark'>
            <Icon name={iconName} size={17} />
          </span>
          <div className='modal-titles'>
            <span className='modal-title'>{title}</span>
            <span className='modal-status status s-running'>
              <span className='dot running' />
              {liveCount} active
            </span>
          </div>
          <button className='modal-x' onClick={dismiss} aria-label='Close'>
            <Icon name='close' size={17} />
          </button>
        </div>

        <div className={s.pickerList}>
          <p className={s.pickerHint}>Pick an instance to open its thread.</p>
          {instances.map((inst) => (
            <div
              key={inst.localId}
              className={`pl-single ${TINT[inst.status]}`}
              onClick={() => onOpenInstance(inst.localId)}
            >
              <div className='m-icon'>
                <Icon name={iconName} size={15} />
              </div>
              <div className='m-text'>
                <span className='m-name'>{inst.label || inst.name}</span>
              </div>
              <span className='m-state'>
                <span className={`dot ${inst.status}`} />
                {STATE_WORD[inst.status]}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
