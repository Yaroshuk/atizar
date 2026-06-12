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
    className={['switch-row', on ? 'on' : '', className].filter(Boolean).join(' ')}
    role='switch'
    aria-checked={on}
    onClick={() => onChange(!on)}
  >
    <span className='switch-text'>
      <span className='switch-title'>{title}</span>
      {sub && <span className='switch-sub'>{sub}</span>}
    </span>
    <span className='switch'>
      <span className='switch-knob' />
    </span>
  </button>
)
