import clsx from 'clsx'
import { Icon, type IconName } from '../../components/Icon'
import s from './Button.module.scss'

// The generic action button. Variants map to the Smedja `.btn-*` classes; every
// value is token-driven so a rebrand needs no component change. Extensible by
// design: it spreads all native <button> attributes and merges `className`, so
// userland can pass onClick, disabled, type, aria-*, data-*, or extra classes.
export type ButtonVariant = 'primary' | 'teal' | 'ghost' | 'soft' | 'danger' | 'retry'

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
  // Stretch to the container width (the `.btn-block` modifier).
  block?: boolean
  // Optional leading icon (rendered before children at `iconSize`, default 14).
  icon?: IconName
  iconSize?: number
}

const VARIANT_CLASS: Record<ButtonVariant, string | undefined> = {
  primary: s.btnPrimary,
  teal: s.btnTeal,
  ghost: s.btnGhost,
  soft: s.btnSoft,
  danger: s.btnDanger,
  retry: s.btnRetry,
}

export const Button = ({
  variant = 'primary',
  block = false,
  icon,
  iconSize = 14,
  className,
  children,
  ...rest
}: ButtonProps) => {
  return (
    <button
      className={clsx(s.btn, VARIANT_CLASS[variant], block && s.btnBlock, className)}
      {...rest}
    >
      {icon && <Icon name={icon} size={iconSize} />}
      {children}
    </button>
  )
}
