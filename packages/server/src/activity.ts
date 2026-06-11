import type { EventBus } from './eventBus.js'

export interface ActivityEntry {
  ts: number
  workflowId: string
  agentId: string
  workItemId: string
  kind: string // 'queued' | 'running' | 'gate' | 'resolved' | 'effect' | 'finished' | 'error' | 'cancelled' | 'delivered'
  summary: string
}

export interface ActivityLog {
  record(entry: ActivityEntry): void
  snapshot(): ActivityEntry[]
}

export function makeActivityLog(opts: { bus: EventBus; limit?: number }): ActivityLog {
  const limit = opts.limit ?? 200
  const ring: ActivityEntry[] = []
  return {
    record(entry) {
      ring.push(entry)
      if (ring.length > limit) ring.shift()
      opts.bus.publish('activity', entry)
    },
    snapshot() {
      return [...ring]
    },
  }
}
