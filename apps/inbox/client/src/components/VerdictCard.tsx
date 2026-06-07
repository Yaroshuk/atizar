type Verdict = {
  threadId: string
  from: string
  subject: string
  summary: string
  category: string
  priority: string
  reason: string
}

type VerdictCardProps = { data: Verdict; onDraftReply: () => void }

export const VerdictCard = ({ data, onDraftReply }: VerdictCardProps) => {
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
      <div style={{ fontSize: 12, color: '#888' }}>✉️ {data.from}</div>
      <div style={{ fontWeight: 600 }}>{data.subject}</div>
      <div style={{ display: 'flex', gap: 6, margin: '6px 0' }}>
        <span
          style={{
            fontSize: 12,
            padding: '2px 8px',
            borderRadius: 12,
            background: '#eef',
            color: '#225',
          }}
        >
          {data.category}
        </span>
        <span
          style={{
            fontSize: 12,
            padding: '2px 8px',
            borderRadius: 12,
            background: '#fee',
            color: '#a33',
          }}
        >
          {data.priority}
        </span>
      </div>
      <div style={{ fontSize: 13, color: '#444' }}>{data.reason}</div>
      {data.threadId && (
        <button
          onClick={onDraftReply}
          style={{
            marginTop: 10,
            background: '#111',
            color: '#fff',
            border: 0,
            borderRadius: 6,
            padding: '6px 14px',
          }}
        >
          Draft reply
        </button>
      )}
    </div>
  )
}
