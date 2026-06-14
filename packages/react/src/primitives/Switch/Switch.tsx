import clsx from 'clsx'
import s from './Switch.module.scss'

// A labelled toggle row (`.switch-row`) — a title + sub line on the left, a
// track+knob switch on the right; the whole row is the click target. Controlled
// via `on`/`onChange`. Extensible via `className`.
type SwitchProps = {
  title: string
  sub?: string
  on: boolean
  onChange: (on: boolean) => void
  className?: string
}

export const Switch = ({ title, sub, on, onChange, className }: SwitchProps) => (
  <button
    type='button'
    className={clsx(s.switchRow, on && s.on, className)}
    role='switch'
    aria-checked={on}
    onClick={() => onChange(!on)}
  >
    <span className={s.switchText}>
      <span className={s.switchTitle}>{title}</span>
      {sub && <span className={s.switchSub}>{sub}</span>}
    </span>
    <span className={s.switch}>
      <span className={s.switchKnob} />
    </span>
  </button>
)
