import { useCallback, useRef, useState } from 'react'
import { useCopilotKit, useRenderToolCall } from '@copilotkit/react-core/v2'
import { instanceId, type AgentDefinition, type Destination } from '@platform/core'
import { useWorkflowRenders } from './useWorkflowRenders'
import { resolveDelivery } from './deliver'
import { useAgentInstances } from './useAgentInstances'
import { aggregateAgent, aggregateLabel } from './aggregate'
import { buildPipeline, type PInstance } from './pipelineModel'
import { AgentCard } from './components/AgentCard'
import { AgentModal, type HandoffNote } from './components/AgentModal'
import { PipelineColumn } from './components/PipelineColumn'
import { WorkflowSwitcher } from './components/WorkflowSwitcher'
import { Icon } from './components/Icon'
import type { Status } from './status'
import { workflows, META, renderSpecs, hitlSpecs } from './workflows'

// Tool names that render as generative-UI cards — everything the client registered a
// renderer for. Anything else (list_my_tickets, get_latest_email, …) is plumbing and
// is hidden from the consumer thread unless dev mode is on.
const renderableToolNames: ReadonlySet<string> = new Set([
  ...renderSpecs.map((s) => s.toolName),
  ...hitlSpecs.map((s) => s.toolName),
])

export const InboxView = () => {
  const { copilotkit } = useCopilotKit()
  const [activeWorkflowId, setActiveWorkflowId] = useState(workflows[0].id)
  const [openId, setOpenId] = useState<string | null>(null) // a live instance localId
  // Handoff notes keyed by the live instance localId (sent on the source, received on
  // the spawned target). A note is attached when the deliver fires; the source instance
  // exists (dispatchers are cap-1) and the target localId is the freshly spawned copy.
  const [handoffNotes, setHandoffNotes] = useState<Record<string, HandoffNote[]>>({})
  const [unread, setUnread] = useState<Record<string, number>>({}) // workflow id -> badge count

  const { instances, spawn, queuedByAgent } = useAgentInstances()

  const workflow = workflows.find((w) => w.id === activeWorkflowId) ?? workflows[0]

  // Mirror live instances so the STABLE deliver callback can read them without a dep.
  // CRITICAL: useRenderTool captures its render closure (and thus deliver) ONCE — a
  // deliver listing instances in deps would freeze the initial (empty) snapshot.
  const instancesRef = useRef(instances)
  instancesRef.current = instances
  // Mirror the active workflow likewise (same capture-once reason).
  const activeRef = useRef(activeWorkflowId)
  activeRef.current = activeWorkflowId

  // The one delivery seam. MUST be stable: useRenderTool captures it once. Resolves the
  // target, spawns a fresh instance (or queues it) in the BACKGROUND. Never opens a
  // modal; never switches view.
  const deliver = useCallback(
    (origin: string, dest: Destination, payload: unknown) => {
      const r = resolveDelivery(workflows, origin, dest, payload)
      if (!r.ok) {
        // A rejected delivery (bad contract/payload) is a dev-time signal, not a user
        // error — surface it to the console rather than silently dropping the parcel.
        // eslint-disable-next-line no-console
        console.warn('delivery rejected:', r.error)
        return
      }
      // The target instance id is `wf__agent`; split off the workflow to find the def.
      const targetWf =
        workflows.find((w) => instanceId(w.id, w.entryAgentId) === r.instanceId) ??
        workflows.find((w) => w.agents.some((a) => instanceId(w.id, a.agent.id) === r.instanceId))
      if (!targetWf) return
      const agentId = r.instanceId.slice(targetWf.id.length + 2) // strip "wf__"
      const def = targetWf.agents.find((a) => a.agent.id === agentId)?.agent
      if (!def) return

      const p = payload as { number?: number; title?: string; subject?: string; from?: string }
      const label =
        typeof p.number === 'number'
          ? `#${p.number}${p.title ? ` · ${p.title}` : ''}`
          : (p.from ?? p.subject ?? 'item')

      // Parent = the live instance of the source agent (cap-1 dispatchers ⇒ unique).
      const sourceAgentId = sourceAgentOf(origin, dest)
      const parent = instancesRef.current.find(
        (x) => x.workflowId === origin && x.agentId === sourceAgentId
      )

      const localId = spawn({
        runtimeKey: r.instanceId,
        agentId,
        workflowId: targetWf.id,
        name: def.name,
        iconName: META[agentId].iconName,
        label,
        approvals: def.approvals,
        maxInstances: def.maxInstances,
        parentLocalId: parent?.localId,
        payload,
      })

      // Handoff notes: a 'sent' note on the source instance, a 'received' note on the
      // spawned target (only if it spawned now — a queued item has no localId yet).
      setHandoffNotes((prev) => {
        const next = { ...prev }
        if (parent) {
          next[parent.localId] = [
            ...(next[parent.localId] ?? []),
            { dir: 'sent', otherName: def.name, label, targetWorkflow: r.targetWorkflow },
          ]
        }
        if (localId) {
          next[localId] = [...(next[localId] ?? []), { dir: 'received', otherName: origin, label }]
        }
        return next
      })

      if (r.targetWorkflow && r.targetWorkflow !== activeRef.current) {
        setUnread((u) => ({ ...u, [r.targetWorkflow!]: (u[r.targetWorkflow!] ?? 0) + 1 }))
      }
    },
    [spawn]
  )

  useWorkflowRenders(deliver)
  const renderToolCall = useRenderToolCall()

  const iid = (agentId: string) => instanceId(workflow.id, agentId)
  const canStart = (agentId: string) =>
    workflow.agents.find((a) => a.agent.id === agentId)?.role === 'input'

  // Launch an input agent: spawn a fresh input instance (it reads the inbox itself).
  const startInput = (agentDef: AgentDefinition) => {
    spawn({
      runtimeKey: iid(agentDef.id),
      agentId: agentDef.id,
      workflowId: workflow.id,
      name: agentDef.name,
      iconName: META[agentDef.id].iconName,
      label: '',
      approvals: agentDef.approvals,
      maxInstances: agentDef.maxInstances,
      isInput: true,
      payload: null,
    })
  }

  // Big-card aggregate: reduce an agent's live instance statuses to a single headline.
  const statusesOf = (agentId: string): Status[] =>
    instances
      .filter((x) => x.workflowId === workflow.id && x.agentId === agentId)
      .map((x) => x.status)
  const aggOf = (agentId: string) => aggregateAgent(statusesOf(agentId))

  // The pipeline reads from the live instances of the active workflow.
  const pInstances: PInstance[] = instances
    .filter((x) => x.workflowId === workflow.id)
    .map((x) => ({
      localId: x.localId,
      runtimeKey: x.runtimeKey,
      agentId: x.agentId,
      name: x.name,
      iconName: x.iconName,
      label: x.label,
      status: x.status,
      parentLocalId: x.parentLocalId,
      isInput: x.isInput,
    }))
  const blocks = buildPipeline(pInstances, queuedByAgent(workflow.id))

  // The open instance (modal keys off a live localId, not an agent id).
  const openInstance = openId ? instances.find((x) => x.localId === openId) : undefined
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const openAgentObj: any = openInstance ? copilotkit.getAgent(openInstance.localId) : undefined

  const switchWorkflow = (id: string) => {
    setOpenId(null)
    setUnread((u) => ({ ...u, [id]: 0 }))
    setActiveWorkflowId(id)
  }

  return (
    <>
      <WorkflowSwitcher
        workflows={workflows}
        activeId={activeWorkflowId}
        unread={unread}
        onSelect={switchWorkflow}
      />

      <div className='workspace-body'>
        <PipelineColumn blocks={blocks} onOpen={(localId) => setOpenId(localId)} />
        <div className='main'>
          <div className='comp-head'>
            <span className='ch-label'>
              <Icon name='layers' size={14} />
              Your agents
            </span>
            <span className='ch-spacer' />
            <span className='legend'>
              <span className='legend-item'>
                <span className='dot idle' />
                Idle
              </span>
              <span className='legend-item'>
                <span className='dot done' />
                Running / done
              </span>
              <span className='legend-item'>
                <span className='dot awaiting_approval' />
                Awaiting approval
              </span>
            </span>
          </div>
          <div className='main-scroll'>
            <div className='agent-grid'>
              {workflow.agents.map(({ agent }) => {
                const agg = aggOf(agent.id)
                return (
                  <AgentCard
                    key={agent.id}
                    name={agent.name}
                    subtitle={META[agent.id].subtitle}
                    iconName={META[agent.id].iconName}
                    status={agg.status}
                    aggregateLabel={aggregateLabel(agg)}
                    canStart={canStart(agent.id)}
                    onStart={() => startInput(agent)}
                    onOpen={() => {
                      // Open the first live instance of this agent type, if any.
                      const live = instances.find(
                        (x) => x.workflowId === workflow.id && x.agentId === agent.id
                      )
                      if (live) setOpenId(live.localId)
                    }}
                  />
                )
              })}
            </div>
          </div>
        </div>

        {openInstance && openAgentObj && (
          <AgentModal
            agent={openAgentObj}
            title={openInstance.name}
            iconName={openInstance.iconName}
            status={openInstance.status}
            renderToolCall={renderToolCall}
            renderableToolNames={renderableToolNames}
            loading={openInstance.status === 'running'}
            canStart={openInstance.isInput}
            intro={META[openInstance.agentId].intro}
            notes={handoffNotes[openInstance.localId] ?? []}
            onOpenWorkflow={switchWorkflow}
            onStart={() => {
              const def = workflow.agents.find((a) => a.agent.id === openInstance.agentId)?.agent
              if (def) startInput(def)
            }}
            onClose={() => setOpenId(null)}
          />
        )}
      </div>
    </>
  )
}

// The source agent for a destination: intra handoff → the agent in the origin workflow
// whose handoffs include the target; contract → the origin's entry agent (the card that
// emitted the delivery lives there).
function sourceAgentOf(origin: string, dest: Destination): string {
  const wf = workflows.find((w) => w.id === origin)
  if (!wf) return origin
  if (dest.kind === 'agent') {
    return (
      wf.agents.find((a) => (a.agent.handoffs ?? []).includes(dest.agentId))?.agent.id ??
      wf.entryAgentId
    )
  }
  return wf.entryAgentId
}
