import { Button } from '../primitives/Button.js'
import type { ConnectionStatus } from '../hooks/useConnections.js'

type ConnectionChipProps = {
  connection: ConnectionStatus
  onDisconnect: () => void
}

// ONE cohesive pill (Smedja style: surface, border, pill radius): a status dot + the
// integration name + a real action button inside, so it reads as a single control — not
// loose labels. Connected → green dot + Disconnect; not connected → grey dot + Connect
// (an <a>, since the OAuth redirect must be a full navigation, styled with the shared
// `.btn` system so it matches the Button primitive).
export const ConnectionChip = ({ connection: c, onDisconnect }: ConnectionChipProps) => {
  const href = `/api/connect/${c.provider}?integration=${encodeURIComponent(
    c.integration
  )}&connection=${encodeURIComponent(c.connection)}`
  return (
    <span className={'conn-chip' + (c.connected ? ' conn-ok' : '')}>
      <span className='conn-dot' />
      <span className='conn-name'>
        {c.integration}
        {c.connected && c.detail ? ` · ${c.detail}` : ''}
      </span>
      {c.connected ? (
        <Button variant='soft' className='btn-sm' onClick={onDisconnect}>
          Disconnect
        </Button>
      ) : (
        <a href={href} className='btn btn-soft btn-sm'>
          Connect
        </a>
      )}
    </span>
  )
}
