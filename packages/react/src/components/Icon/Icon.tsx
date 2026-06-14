import type { ReactNode } from 'react'

// One Icon component + an internal name→paths map. Keeps the strict
// one-component-per-file rule (no icon-component sprawl) while giving us the
// thin line / Lucide-style glyphs the Smedja design uses.
//
// Glyphs are stroked (fill:none, stroke:currentColor) EXCEPT the few filled ones
// listed in FILLED — those set their own fill on the child path so the single
// wrapper stays simple. Extending = add a name to IconName + a PATHS entry.
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
  // chrome / observability glyphs (Smedja Consumer Desktop v2)
  | 'leads'
  | 'analytics'
  | 'settings'
  | 'mail'
  | 'reply'
  | 'review'
  | 'play'
  | 'check'
  | 'send'
  | 'shield'
  | 'chevron'
  | 'chevron-right'
  | 'chevrons-left'
  | 'panel-left'
  | 'branch'
  | 'bell'
  | 'refresh'
  | 'clock'
  | 'gear'
  | 'activity'
  | 'filter'
  | 'link'
  | 'trash'
  | 'star'

type IconProps = {
  name: IconName
  size?: number
  className?: string
  style?: React.CSSProperties
}

// Names whose glyph is a filled shape (the child path carries its own fill).
const FILLED: ReadonlySet<IconName> = new Set<IconName>(['play', 'sparkle'])

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
  sparkle: (
    <path d='M12 2l1.9 6.1L20 10l-6.1 1.9L12 18l-1.9-6.1L4 10l6.1-1.9z' fill='currentColor' />
  ),
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
  leads: (
    <>
      <path d='M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2' />
      <circle cx='9' cy='7' r='4' />
      <path d='M22 21v-2a4 4 0 0 0-3-3.87' />
      <path d='M16 3.13a4 4 0 0 1 0 7.75' />
    </>
  ),
  analytics: (
    <>
      <path d='M3 3v18h18' />
      <path d='M7 15l3.5-4 3 2.5L20 7' />
    </>
  ),
  settings: (
    <>
      <circle cx='12' cy='12' r='3' />
      <path d='M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z' />
    </>
  ),
  mail: (
    <>
      <rect x='3' y='5' width='18' height='14' rx='2' />
      <path d='m3 7 9 6 9-6' />
    </>
  ),
  reply: (
    <>
      <path d='M9 17l-5-5 5-5' />
      <path d='M4 12h11a5 5 0 0 1 5 5v2' />
    </>
  ),
  review: (
    <>
      <path d='M14 3v4a1 1 0 0 0 1 1h4' />
      <path d='M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2Z' />
      <path d='m9 14 2 2 4-4' />
    </>
  ),
  play: (
    <path
      d='M7 4.5v15a1 1 0 0 0 1.54.84l11.5-7.5a1 1 0 0 0 0-1.68L8.54 3.66A1 1 0 0 0 7 4.5Z'
      fill='currentColor'
    />
  ),
  check: <path d='M20 6 9 17l-5-5' />,
  send: (
    <path d='M14.5 9.5 21 3m0 0-6.5 18a.5.5 0 0 1-.93.06L10 13l-7.06-3.57a.5.5 0 0 1 .06-.93L21 3Z' />
  ),
  shield: (
    <>
      <path d='M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3Z' />
      <path d='m9.5 12 1.7 1.7L15 10' />
    </>
  ),
  chevron: <path d='m6 9 6 6 6-6' />,
  'chevron-right': <path d='m9 18 6-6-6-6' />,
  'chevrons-left': (
    <>
      <path d='m11 17-5-5 5-5' />
      <path d='m18 17-5-5 5-5' />
    </>
  ),
  'panel-left': (
    <>
      <rect x='3' y='4' width='18' height='16' rx='2' />
      <path d='M9 4v16' />
    </>
  ),
  branch: (
    <>
      <circle cx='6' cy='6' r='2.4' />
      <circle cx='6' cy='18' r='2.4' />
      <circle cx='18' cy='8' r='2.4' />
      <path d='M6 8.4v7.2' />
      <path d='M18 10.4c0 4-3 5.6-6 5.6' />
    </>
  ),
  bell: (
    <>
      <path d='M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9' />
      <path d='M10.3 21a1.94 1.94 0 0 0 3.4 0' />
    </>
  ),
  refresh: (
    <>
      <path d='M21 12a9 9 0 1 1-3-6.7' />
      <path d='M21 4v5h-5' />
    </>
  ),
  clock: (
    <>
      <circle cx='12' cy='12' r='9' />
      <path d='M12 7v5l3 2' />
    </>
  ),
  gear: (
    <>
      <circle cx='12' cy='12' r='3' />
      <path d='M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z' />
    </>
  ),
  activity: <path d='M22 12h-4l-3 9L9 3l-3 9H2' />,
  filter: <path d='M3 5h18l-7 8v6l-4 2v-8L3 5Z' />,
  link: (
    <>
      <path d='M9 15l6-6' />
      <path d='M11 6l1-1a4 4 0 0 1 6 6l-2 2' />
      <path d='M13 18l-1 1a4 4 0 0 1-6-6l2-2' />
    </>
  ),
  trash: (
    <>
      <path d='M3 6h18' />
      <path d='M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2' />
      <line x1='10' y1='11' x2='10' y2='17' />
      <line x1='14' y1='11' x2='14' y2='17' />
    </>
  ),
  star: (
    <polygon points='12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2' />
  ),
}

export const Icon = ({ name, size = 16, className, style }: IconProps) => (
  <svg
    className={className}
    style={style}
    width={size}
    height={size}
    viewBox='0 0 24 24'
    fill='none'
    stroke='currentColor'
    strokeWidth={FILLED.has(name) ? 0 : 2}
    strokeLinecap='round'
    strokeLinejoin='round'
    aria-hidden='true'
  >
    {PATHS[name]}
  </svg>
)
