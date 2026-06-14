import { CardShell } from '@atizar/react'
import s from './LeadCard.module.scss'

type Lead = { from: string; subject: string; summary: string }

type LeadCardProps = { lead: Lead }

export const LeadCard = ({ lead }: LeadCardProps) => (
  <CardShell icon='envelope' kicker={lead.from} title={lead.subject}>
    <p className={s.reason}>{lead.summary}</p>
  </CardShell>
)
