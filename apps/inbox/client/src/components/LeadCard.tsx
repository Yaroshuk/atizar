type Lead = { id: number; from: string; subject: string; intent: string }

export function LeadCard({ lead }: { lead: Lead }) {
  return (
    <div
      style={{
        border: '1px solid #ddd',
        borderRadius: 10,
        padding: 12,
        background: '#fff',
        margin: '8px 0',
      }}
    >
      <div style={{ fontSize: 12, color: '#888' }}>✉️ {lead.from}</div>
      <div style={{ fontWeight: 600 }}>{lead.subject}</div>
      <span style={{ fontSize: 12, color: '#0a7' }}>{lead.intent}</span>
    </div>
  )
}
