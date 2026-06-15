import clsx from 'clsx'
import s from './StopButton.module.scss'

// One Stop control, three scopes, one visual language (neutral outline that
// reddens on hover; a square glyph that becomes a spinner while stopping):
//   - 'item'     — icon-only, sits on a running work-item card in the pipeline
//   - 'workflow' — labelled, in a workflow header (bulk → confirm upstream)
//   - 'all'      — labelled + most prominent (red glyph), the global emergency brake
// Extensible: spreads native <button> attributes and merges `className`.
export type StopScope = 'item' | 'workflow' | 'all'

type StopButtonProps = Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  scope?: StopScope
  // Shown next to the glyph on 'workflow'/'all'; omit for the icon-only 'item'.
  label?: string
  // Mid-stop state: swaps the glyph for a spinner, disables the button.
  stopping?: boolean
}

export const StopButton = ({
  scope = 'item',
  label,
  stopping = false,
  disabled,
  className,
  title,
  ...rest
}: StopButtonProps) => {
  return (
    <button
      className={clsx(
        s.stopBtn,
        scope === 'all' && s.danger,
        // icon-only whenever there's no label: the per-item stop, and the compact
        // workflow stop in the narrow Pipeline header.
        (scope === 'item' || !label) && s.icon,
        stopping && s.stopping,
        className
      )}
      disabled={disabled || stopping}
      title={title || label || 'Stop'}
      aria-label={label || title || 'Stop'}
      {...rest}
    >
      {stopping ? (
        <span className={s.stopSpin} aria-hidden='true' />
      ) : (
        <span className={s.stopGlyph} aria-hidden='true' />
      )}
      {label && <span className={s.stopLabel}>{stopping ? 'Stopping…' : label}</span>}
    </button>
  )
}
