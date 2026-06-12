// A small segmented toggle (the Manager/Admin switch and the Activity/Trace
// switch). Two style families share one component via `variant`:
//   - 'admin' → `.admin-toggle` / `.at-opt`
//   - 'seg'   → `.act-seg` / `.act-seg-opt`
// Generic over the option value type; extensible via `className` on the group.
type SegmentedOption<T extends string> = { value: T; label: string }

type SegmentedProps<T extends string> = {
  options: ReadonlyArray<SegmentedOption<T>>
  value: T
  onChange: (value: T) => void
  variant?: 'admin' | 'seg'
  ariaLabel?: string
  className?: string
}

const GROUP_CLASS = { admin: 'admin-toggle', seg: 'act-seg' } as const
const OPT_CLASS = { admin: 'at-opt', seg: 'act-seg-opt' } as const

export const Segmented = <T extends string>({
  options,
  value,
  onChange,
  variant = 'seg',
  ariaLabel,
  className,
}: SegmentedProps<T>) => (
  <div
    className={[GROUP_CLASS[variant], className].filter(Boolean).join(' ')}
    role='tablist'
    aria-label={ariaLabel}
  >
    {options.map((o) => (
      <button
        key={o.value}
        className={OPT_CLASS[variant] + (o.value === value ? ' on' : '')}
        role='tab'
        aria-selected={o.value === value}
        onClick={() => onChange(o.value)}
      >
        {o.label}
      </button>
    ))}
  </div>
)
