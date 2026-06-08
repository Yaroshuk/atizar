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
