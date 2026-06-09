import { useCallback, useRef, useState } from 'react'
import { useCopilotKit } from '@copilotkit/react-core/v2'
import { encodeHandoff, type Message } from '@platform/core'
import { statusFrom } from './statusFrom'
import { canSpawn, liveDuplicate, type Routable } from './instancesCore'
import type { PInstance } from './pipelineModel'
import type { Status } from './status'

export type SpawnArgs = {
  runtimeKey: string // instanceId(wf, agent) — the server agent id
  agentId: string
  workflowId: string
  name: string
  iconName: PInstance['iconName']
  label: string
  approvals: readonly string[]
  maxInstances: number
  parentLocalId?: string
  isInput?: boolean
  // seed: handoff payload (workers) or null (an input agent reads the inbox itself)
  payload: unknown | null
  // Identity of the source item this delivery acts on. When set, a repeated delivery
  // for the same (runtimeKey, deliveryKey) is deduped instead of spawning a duplicate.
  deliveryKey?: string
}

// Outcome of a spawn: `localId` is the new (or existing, when deduped) instance's id,
// or undefined when the item was queued. `deduped` is true when an existing live or
// queued copy already covers this delivery, so no new instance was created.
export type SpawnResult = { localId?: string; deduped: boolean }

type Live = PInstance & {
  workflowId: string
  deliveryKey?: string
  unregister: () => void
  subId?: { unsubscribe: () => void }
}
type Pending = { args: SpawnArgs }

let seq = 0
const nextLocalId = (runtimeKey: string) => `${runtimeKey}#${++seq}`

export const useAgentInstances = () => {
  const { copilotkit } = useCopilotKit()
  const [instances, setInstances] = useState<Live[]>([])
  const [queued, setQueued] = useState<Record<string, Pending[]>>({})

  // instRef is the SYNCHRONOUS source of truth for the instance list: every list change
  // mutates it via `commit` alongside setInstances, so a same-tick second spawn sees spawns
  // from earlier in the same tick (React commits state only between ticks). queueRef still
  // mirrors state on render — its callbacks don't need same-tick reads.
  const instRef = useRef(instances)
  const queueRef = useRef(queued)
  queueRef.current = queued

  const commit = useCallback((next: Live[]) => {
    instRef.current = next
    setInstances(next)
  }, [])

  const update = useCallback(
    (localId: string, patch: Partial<Live>) => {
      commit(instRef.current.map((x) => (x.localId === localId ? { ...x, ...patch } : x)))
    },
    [commit]
  )

  const remove = useCallback(
    (localId: string) => {
      commit(instRef.current.filter((x) => x.localId !== localId))
    },
    [commit]
  )

  // Forward-declared so onFinalized can call drain.
  const startRef = useRef<(args: SpawnArgs) => string>(() => '')

  const onFinalized = useCallback(
    (localId: string, runtimeKey: string, finalStatus: Status) => {
      const self = instRef.current.find((x) => x.localId === localId)
      if (!self) return
      const hasLiveChild = instRef.current.some(
        (x) => x.parentLocalId === localId && x.status !== 'done'
      )
      // KEEP the instance (don't tear down, don't free its slot) when it still needs a
      // human or is otherwise live: an input agent (pipeline root), a parent whose child
      // is still running, an errored run, OR — crucially — a run that finalized while
      // AWAITING APPROVAL. With the claude-cli provider, HITL kills the process at the
      // approval tool call, so the run finalizes; the instance must stay visible as
      // `awaiting_approval` (resume = re-prime on the same proxy), not vanish as "done".
      const keep =
        self.isInput ||
        hasLiveChild ||
        finalStatus === 'error' ||
        finalStatus === 'awaiting_approval'
      let freed = false
      if (!keep) {
        self.subId?.unsubscribe()
        self.unregister()
        remove(localId)
        freed = true
      }
      // Drain one queued item for this runtimeKey only if a slot actually freed.
      if (freed) {
        const q = queueRef.current[runtimeKey] ?? []
        if (q.length) {
          const [next, ...rest] = q
          setQueued((prev) => ({ ...prev, [runtimeKey]: rest }))
          startRef.current(next.args)
        }
      }
    },
    [remove]
  )

  const start = useCallback(
    (args: SpawnArgs) => {
      const localId = nextLocalId(args.runtimeKey)
      const { agent, unregister } = copilotkit.registerProxiedAgent({
        agentId: localId,
        runtimeAgentId: args.runtimeKey,
      })
      if (args.payload !== null) {
        agent.messages.splice(0, agent.messages.length, encodeHandoff(args.payload) as Message)
      }
      const live: Live = {
        localId,
        runtimeKey: args.runtimeKey,
        agentId: args.agentId,
        workflowId: args.workflowId,
        name: args.name,
        iconName: args.iconName,
        label: args.label,
        status: 'running',
        parentLocalId: args.parentLocalId,
        isInput: !!args.isInput,
        deliveryKey: args.deliveryKey,
        unregister,
      }
      let lifecycle: 'running' | 'done' | 'error' = 'running'
      const recompute = () =>
        update(localId, {
          status: statusFrom(lifecycle, agent.messages as Message[], args.approvals),
        })
      const subId = agent.subscribe({
        onRunStartedEvent: () => {
          lifecycle = 'running'
          recompute()
        },
        onRunFailed: () => {
          lifecycle = 'error'
          recompute()
        },
        onMessagesChanged: () => recompute(),
        onRunFinalized: () => {
          if (lifecycle !== 'error') lifecycle = 'done'
          recompute()
          // Derive the SETTLED status (awaiting_approval/error win over done) so the
          // teardown decision matches what the pipeline shows.
          const finalStatus = statusFrom(lifecycle, agent.messages as Message[], args.approvals)
          onFinalized(localId, args.runtimeKey, finalStatus)
        },
      })
      live.subId = subId
      // Append synchronously BEFORE runAgent returns control, so a same-tick second spawn
      // counts this instance against the cap.
      commit([...instRef.current, live])
      void copilotkit.runAgent({ agent })
      return localId
    },
    [copilotkit, update, onFinalized, commit]
  )
  startRef.current = start

  // Public: dedupe, then spawn or enqueue based on the cap. A delivery carrying a
  // deliveryKey is deduped against live instances AND the queue for the same target, so
  // a repeated one-time delivery (e.g. clicking "Draft reply" again on the same email)
  // returns the existing copy instead of spawning a duplicate.
  const spawn = useCallback(
    (args: SpawnArgs): SpawnResult => {
      if (args.deliveryKey) {
        const existing = liveDuplicate(instRef.current, args.runtimeKey, args.deliveryKey)
        if (existing) return { localId: existing, deduped: true }
        const q = queueRef.current[args.runtimeKey] ?? []
        if (q.some((p) => p.args.deliveryKey === args.deliveryKey))
          return { localId: undefined, deduped: true }
      }
      const routables: Routable[] = instRef.current.map((x) => ({
        runtimeKey: x.runtimeKey,
        status: x.status,
      }))
      if (canSpawn(routables, args.runtimeKey, args.maxInstances))
        return { localId: start(args), deduped: false }
      setQueued((prev) => ({
        ...prev,
        [args.runtimeKey]: [...(prev[args.runtimeKey] ?? []), { args }],
      }))
      return { localId: undefined, deduped: false }
    },
    [start]
  )

  // queued counts keyed by AGENT id (for the pipeline group), for the active workflow.
  const queuedByAgent = useCallback((workflowId: string): Record<string, number> => {
    const out: Record<string, number> = {}
    for (const [, items] of Object.entries(queueRef.current)) {
      for (const p of items) {
        if (p.args.workflowId === workflowId) out[p.args.agentId] = (out[p.args.agentId] ?? 0) + 1
      }
    }
    return out
  }, [])

  return { instances, spawn, queuedByAgent }
}
