import { useConnections, type ConnectionStatus } from '../hooks/useConnections.js'
import { ConnectionChip } from './ConnectionChip.js'

// The Connections panel: lists every required integration with its chip. A Disconnect on a
// row DELETEs the connection then refetches the snapshot. Self-fetches — no props needed.
export const Connections = () => {
  const { connections, refetch } = useConnections()

  const disconnect = async (c: ConnectionStatus): Promise<void> => {
    await fetch(
      `/api/connections/${encodeURIComponent(c.integration)}?connection=${encodeURIComponent(
        c.connection
      )}`,
      { method: 'DELETE' }
    )
    refetch()
  }

  return (
    <div className='conn-list'>
      {connections.map((c) => (
        <ConnectionChip
          key={`${c.integration}:${c.connection}`}
          connection={c}
          onDisconnect={() => void disconnect(c)}
        />
      ))}
    </div>
  )
}
