import { Icon, type IconName } from '../components/Icon'

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

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: 'btn-primary',
  teal: 'btn-teal',
  ghost: 'btn-ghost',
  soft: 'btn-soft',
  danger: 'btn-danger',
  retry: 'btn-retry',
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
  const cls = ['btn', VARIANT_CLASS[variant], block ? 'btn-block' : '', className]
    .filter(Boolean)
    .join(' ')
  return (
    <button className={cls} {...rest}>
      {icon && <Icon name={icon} size={iconSize} />}
      {children}
    </button>
  )
}
