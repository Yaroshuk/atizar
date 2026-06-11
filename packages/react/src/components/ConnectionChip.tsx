import type { ConnectionStatus } from '../hooks/useConnections.js'

type ConnectionChipProps = {
  connection: ConnectionStatus
  onDisconnect: () => void
}

// Presentational: a not-connected (or failed/expired) integration shows a Connect/Reconnect
// link — a FULL navigation (not fetch) so the OAuth redirect can happen. A connected one
// shows its label (+ detail when present) and a Disconnect button.
export const ConnectionChip = ({ connection: c, onDisconnect }: ConnectionChipProps) => {
  if (!c.connected) {
    const href = `/api/connect/${c.provider}?integration=${encodeURIComponent(
      c.integration
    )}&connection=${encodeURIComponent(c.connection)}`
    return (
      <span className='connection-chip'>
        <span>{c.integration}</span>
        <a href={href} className='btn btn-ghost'>
          Connect
        </a>
      </span>
    )
  }

  return (
    <span className='connection-chip'>
      <span>
        {c.integration} ✓{c.detail ? ` ${c.detail}` : ''}
      </span>
      <button type='button' className='btn btn-ghost' onClick={onDisconnect}>
        Disconnect
      </button>
    </span>
  )
}
