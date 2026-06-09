import type { Status } from './status'

// Minimal shape the routing logic needs (the hook's Instance is a superset).
export type Routable = { runtimeKey: string; status: Status }

// Live = occupies a slot. A done instance is being torn down, so it does not count.
export const liveCount = (instances: Routable[], runtimeKey: string): number =>
  instances.filter((i) => i.runtimeKey === runtimeKey && i.status !== 'done').length

// A free slot exists when live copies are below the agent's cap.
export const canSpawn = (
  instances: Routable[],
  runtimeKey: string,
  maxInstances: number
): boolean => liveCount(instances, runtimeKey) < maxInstances

// An instance carrying the source-item identity of the delivery that spawned it.
export type Identified = Routable & { deliveryKey?: string; localId: string }

// The localId of an existing LIVE instance for the same target (runtimeKey) acting on
// the same source item (deliveryKey), or undefined when none exists. Used to dedupe a
// repeated one-time delivery: a second click focuses the existing copy instead of
// spawning a duplicate. A `done` instance is being torn down, so it does not count.
export const liveDuplicate = (
  instances: Identified[],
  runtimeKey: string,
  deliveryKey: string
): string | undefined =>
  instances.find(
    (i) => i.runtimeKey === runtimeKey && i.deliveryKey === deliveryKey && i.status !== 'done'
  )?.localId
