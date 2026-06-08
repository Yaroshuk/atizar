import { useCallback, useRef, useState } from 'react'
import { useCopilotKit } from '@copilotkit/react-core/v2'
import { encodeHandoff, type Message } from '@platform/core'
import { statusFrom } from './statusFrom'
import { canSpawn, type Routable } from './instancesCore'
import type { PInstance } from './pipelineModel'

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
}

type Live = PInstance & {
  workflowId: string
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

  // Mirror current state for the stable callbacks.
  const instRef = useRef(instances)
  instRef.current = instances
  const queueRef = useRef(queued)
  queueRef.current = queued

  const update = useCallback((localId: string, patch: Partial<Live>) => {
    setInstances((prev) => prev.map((x) => (x.localId === localId ? { ...x, ...patch } : x)))
  }, [])

  const remove = useCallback((localId: string) => {
    setInstances((prev) => prev.filter((x) => x.localId !== localId))
  }, [])

  // Forward-declared so onFinalized can call drain.
  const startRef = useRef<(args: SpawnArgs) => string>(() => '')

  const onFinalized = useCallback(
    (localId: string, runtimeKey: string, lifecycle: 'running' | 'done' | 'error') => {
      const self = instRef.current.find((x) => x.localId === localId)
      if (!self) return
      const hasLiveChild = instRef.current.some(
        (x) => x.parentLocalId === localId && x.status !== 'done'
      )
      // Input agents, parents-with-live-children, and errored instances stay; others tear down.
      let freed = false
      if (!self.isInput && !hasLiveChild && lifecycle !== 'error') {
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
          onFinalized(localId, args.runtimeKey, lifecycle)
        },
      })
      live.subId = subId
      setInstances((prev) => [...prev, live])
      void copilotkit.runAgent({ agent })
      return localId
    },
    [copilotkit, update, onFinalized]
  )
  startRef.current = start

  // Public: spawn or enqueue based on the cap. Returns the new instance's localId when
  // it started immediately, or undefined when the item was queued (no instance yet).
  const spawn = useCallback(
    (args: SpawnArgs): string | undefined => {
      const routables: Routable[] = instRef.current.map((x) => ({
        runtimeKey: x.runtimeKey,
        status: x.status,
      }))
      if (canSpawn(routables, args.runtimeKey, args.maxInstances)) return start(args)
      setQueued((prev) => ({
        ...prev,
        [args.runtimeKey]: [...(prev[args.runtimeKey] ?? []), { args }],
      }))
      return undefined
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
