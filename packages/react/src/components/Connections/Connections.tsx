import { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import { useConnections, type ConnectionStatus } from '../../hooks/useConnections.js'
import { ConnectionChip } from '../ConnectionChip/ConnectionChip.js'
import { Icon } from '../Icon/Icon.js'
import { useWorkflowsConfig } from '../../workflowsContext.js'
import { authHeaders } from '../../authHeaders.js'
import s from './Connections.module.scss'

// The Connections control: ONE compact trigger (link icon + a summary status dot + a
// count) that toggles a popover listing the integration chips. The summary dot is teal
// when every connection is up, amber when any needs attention. A Disconnect on a chip
// DELETEs the connection then refetches the snapshot. Self-fetches — no props needed.
export const Connections = () => {
  const { connections, refetch } = useConnections()
  const { authToken } = useWorkflowsConfig()
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  const allConnected = connections.every((c) => c.connected)

  // Dismiss the popover on an outside click or Escape — listeners attach only while open.
  useEffect(() => {
    if (!open) return
    const onMouseDown = (e: MouseEvent): void => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

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
    <div className={s.wrap} ref={wrapRef}>
      <button
        type='button'
        className={s.trigger}
        aria-label='Connections'
        title={allConnected ? 'All connected' : 'Action needed'}
        onClick={() => setOpen((v) => !v)}
      >
        <Icon name='link' />
        <span className={clsx(s.summaryDot, allConnected ? s.ok : s.warn)} />
        {connections.length > 1 && <span className={s.count}>{connections.length}</span>}
      </button>
      {open && (
        <div className={s.popover}>
          {connections.map((c) => (
            <ConnectionChip
              key={`${c.integration}:${c.connection}`}
              connection={c}
              onDisconnect={() => void disconnect(c)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
