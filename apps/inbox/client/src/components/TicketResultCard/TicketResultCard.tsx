import { CardShell } from '@atizar/react'
import s from './TicketResultCard.module.scss'

type TicketResultCardProps = { data: { title: string; kind: string; analysis: string } }

export const TicketResultCard = ({ data }: TicketResultCardProps) => (
  <CardShell
    icon={data.kind === 'bug' ? 'bug' : 'wrench'}
    kicker={data.kind === 'bug' ? 'Bug analysis' : 'Feature plan'}
    title={data.title}
  >
    <p className={s.reason}>{data.analysis}</p>
  </CardShell>
)
