import { useConnections, type ConnectionStatus } from '../../hooks/useConnections.js'
import { ConnectionChip } from '../ConnectionChip/ConnectionChip.js'
import { useWorkflowsConfig } from '../../workflowsContext.js'
import { authHeaders } from '../../authHeaders.js'
import s from './Connections.module.scss'

// The Connections panel: lists every required integration with its chip. A Disconnect on a
// row DELETEs the connection then refetches the snapshot. Self-fetches — no props needed.
export const Connections = () => {
  const { connections, refetch } = useConnections()
  const { authToken } = useWorkflowsConfig()

  const disconnect = async (c: ConnectionStatus): Promise<void> => {
    await fetch(
      `/api/connections/${encodeURIComponent(c.integration)}?connection=${encodeURIComponent(
        c.connection
      )}`,
      { method: 'DELETE', headers: authHeaders(authToken) }
    )
    refetch()
  }

  return (
    <div className={s.connList}>
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
