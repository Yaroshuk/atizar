import { CardShell, Markdown } from '@atizar/react'
import s from './LeadCard.module.scss'

type Lead = { from: string; subject: string; summary: string }

type LeadCardProps = { lead: Lead }

export const LeadCard = ({ lead }: LeadCardProps) => (
  <CardShell icon='envelope' kicker={lead.from} title={lead.subject}>
    <div className={s.reason}>
      <Markdown>{lead.summary}</Markdown>
    </div>
  </CardShell>
)
