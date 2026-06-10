import { EventEmitter } from 'node:events'

// One in-process pub/sub over a single EventEmitter. Topics: `board` (coarse status changes)
// and `workitem:<id>` (per-WorkItem trace events). Cross-process pub/sub is an explicit beta
// deferral (spec §2) — this seam swaps for one without touching callers.
export interface EventBus {
  publish(topic: string, msg: unknown): void
  subscribe(topic: string, fn: (msg: unknown) => void): () => void
}

export function makeEventBus(): EventBus {
  const ee = new EventEmitter()
  ee.setMaxListeners(0) // many SSE tails attach to one WorkItem topic
  return {
    publish(topic, msg) {
      ee.emit(topic, msg)
    },
    subscribe(topic, fn) {
      ee.on(topic, fn)
      return () => ee.off(topic, fn)
    },
  }
}
