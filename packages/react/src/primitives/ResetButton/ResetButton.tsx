import clsx from 'clsx'
import s from './ResetButton.module.scss'

// One Reset control, two scopes, one visual language (neutral outline that tints on hover;
// a broom/clear glyph that becomes a spinner while resetting). Reset CLEARS finished items
// from the live board (hidden, never deleted — I12); the confirm gate for in-progress work
// lives in the caller (useResetController), not here.
//   - 'workflow' — labelled, in the Pipeline header (clear this workflow's done items)
//   - 'all'      — labelled, the global "Reset all" next to "Stop all"
// Extensible: spreads native <button> attributes and merges `className`.
export type ResetScope = 'workflow' | 'all'

type ResetButtonProps = Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  scope?: ResetScope
  // Shown next to the glyph.
  label?: string
  // Mid-reset state: swaps the glyph for a spinner, disables the button.
  resetting?: boolean
}

export const ResetButton = ({
  scope = 'workflow',
  label,
  resetting = false,
  disabled,
  className,
  title,
  ...rest
}: ResetButtonProps) => {
  return (
    <button
      className={clsx(s.resetBtn, scope === 'all' && s.all, resetting && s.resetting, className)}
      disabled={disabled || resetting}
      title={title || label || 'Reset'}
      aria-label={label || title || 'Reset'}
      {...rest}
    >
      {resetting ? (
        <span className={s.resetSpin} aria-hidden='true' />
      ) : (
        <span className={s.resetGlyph} aria-hidden='true' />
      )}
      {label && <span className={s.resetLabel}>{resetting ? 'Resetting…' : label}</span>}
    </button>
  )
}
