import type { ReactNode } from 'react'

// One Icon component + an internal name→paths map. Keeps the strict
// one-component-per-file rule (no icon-component sprawl) while giving us the
// thin line / Lucide-style glyphs the Smedja design uses.
export type IconName =
  | 'inbox'
  | 'pen'
  | 'pipeline'
  | 'layers'
  | 'envelope'
  | 'alert'
  | 'sparkle'
  | 'close'
  | 'git'
  | 'bug'
  | 'wrench'

type IconProps = {
  name: IconName
  size?: number
  className?: string
}

const PATHS: Record<IconName, ReactNode> = {
  inbox: (
    <>
      <path d='M22 12h-6l-2 3h-4l-2-3H2' />
      <path d='M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z' />
    </>
  ),
  pen: (
    <>
      <path d='M12 20h9' />
      <path d='M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z' />
    </>
  ),
  pipeline: (
    <>
      <line x1='6' y1='3' x2='6' y2='15' />
      <circle cx='18' cy='6' r='3' />
      <circle cx='6' cy='18' r='3' />
      <path d='M18 9a9 9 0 0 1-9 9' />
    </>
  ),
  layers: (
    <>
      <polygon points='12 2 2 7 12 12 22 7 12 2' />
      <polyline points='2 17 12 22 22 17' />
      <polyline points='2 12 12 17 22 12' />
    </>
  ),
  envelope: (
    <>
      <rect x='2' y='4' width='20' height='16' rx='2' />
      <path d='m22 7-10 5L2 7' />
    </>
  ),
  alert: (
    <>
      <path d='M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z' />
      <line x1='12' y1='9' x2='12' y2='13' />
      <line x1='12' y1='17' x2='12.01' y2='17' />
    </>
  ),
  sparkle: <path d='M12 2l1.9 6.1L20 10l-6.1 1.9L12 18l-1.9-6.1L4 10l6.1-1.9z' />,
  close: (
    <>
      <line x1='18' y1='6' x2='6' y2='18' />
      <line x1='6' y1='6' x2='18' y2='18' />
    </>
  ),
  git: (
    <>
      <circle cx='12' cy='6' r='3' />
      <circle cx='6' cy='18' r='3' />
      <circle cx='18' cy='18' r='3' />
      <path d='M12 9v3a6 6 0 0 1-6 6M12 12a6 6 0 0 0 6 6' />
    </>
  ),
  bug: (
    <>
      <rect x='8' y='6' width='8' height='14' rx='4' />
      <path d='M19 7l-3 2M5 7l3 2M3 13h3M18 13h3M19 19l-3-2M5 19l3-2M12 2v4' />
    </>
  ),
  wrench: (
    <path d='M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2-2 2.6-2.6z' />
  ),
}

export const Icon = ({ name, size = 16, className }: IconProps) => (
  <svg
    className={className}
    width={size}
    height={size}
    viewBox='0 0 24 24'
    fill='none'
    stroke='currentColor'
    strokeWidth={2}
    strokeLinecap='round'
    strokeLinejoin='round'
    aria-hidden='true'
  >
    {PATHS[name]}
  </svg>
)
