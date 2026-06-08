import { useCallback, useMemo, useRef, useState } from 'react'
import { useCopilotKit, useRenderToolCall } from '@copilotkit/react-core/v2'
import { instanceId, encodeHandoff, type Destination, type Message } from '@platform/core'
import { useWorkflowRenders } from './useWorkflowRenders'
import { resolveDelivery } from './deliver'
import { AgentCard } from './components/AgentCard'
import { AgentModal, type HandoffNote } from './components/AgentModal'
import { AgentRuntime, type AgentHandle } from './components/AgentRuntime'
import { PipelineColumn } from './components/PipelineColumn'
import { WorkflowSwitcher } from './components/WorkflowSwitcher'
import { Icon } from './components/Icon'
import type { PipelineNode } from './pipeline'
import type { Status } from './status'
import { workflows, META } from './workflows'

export const InboxView = () => {
  const { copilotkit } = useCopilotKit()
  const [activeWorkflowId, setActiveWorkflowId] = useState(workflows[0].id)
  const [openId, setOpenId] = useState<string | null>(null) // instance id
  const [handles, setHandles] = useState<Record<string, AgentHandle>>({}) // keyed by instance id
  const [handoffNotes, setHandoffNotes] = useState<Record<string, HandoffNote[]>>({})
  const [unread, setUnread] = useState<Record<string, number>>({}) // workflow id -> badge count

  const workflow = workflows.find((w) => w.id === activeWorkflowId) ?? workflows[0]

  const onAgentChange = useCallback((id: string, handle: AgentHandle) => {
    setHandles((prev) => {
      const cur = prev[id]
      if (cur && cur.agent === handle.agent && cur.status === handle.status) return prev
      return { ...prev, [id]: handle }
    })
  }, [])

  const handlesRef = useRef(handles)
  handlesRef.current = handles
  // Mirror the active workflow so the STABLE deliver callback can read it without a
  // dep. CRITICAL: useRenderTool captures its render closure (and thus deliver) ONCE
  // — a deliver with activeWorkflowId in deps would freeze the initial value.
  const activeRef = useRef(activeWorkflowId)
  activeRef.current = activeWorkflowId

  // The one delivery seam. MUST be stable: useRenderTool captures it once. Resolves the
  // target, seeds + runs it in the BACKGROUND. Never opens a modal; never switches view.
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
      const target = handlesRef.current[r.instanceId]?.agent
      if (!target) return
      target.messages.splice(0, target.messages.length, encodeHandoff(payload) as Message)
      void copilotkit.runAgent({ agent: target })

      const p = payload as { number?: number; title?: string; subject?: string }
      const label =
        typeof p.number === 'number'
          ? `#${p.number} ${p.title ?? ''}`.trim()
          : (p.subject ?? 'item')
      const sourceInstance = instanceId(origin, sourceAgentOf(origin, dest))
      setHandoffNotes((prev) => ({
        ...prev,
        [sourceInstance]: [
          ...(prev[sourceInstance] ?? []),
          { dir: 'sent', otherName: r.instanceId, label, targetWorkflow: r.targetWorkflow },
        ],
        [r.instanceId]: [
          ...(prev[r.instanceId] ?? []),
          { dir: 'received', otherName: origin, label },
        ],
      }))
      if (r.targetWorkflow && r.targetWorkflow !== activeRef.current) {
        setUnread((u) => ({ ...u, [r.targetWorkflow!]: (u[r.targetWorkflow!] ?? 0) + 1 }))
      }
    },
    [copilotkit]
  )

  useWorkflowRenders(deliver)
  const renderToolCall = useRenderToolCall()

  const iid = (agentId: string) => instanceId(workflow.id, agentId)
  const statusOf = (instId: string): Status => handles[instId]?.status ?? 'idle'
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const agentOf = (instId: string): any => handles[instId]?.agent
  const canStart = (agentId: string) =>
    workflow.agents.find((a) => a.agent.id === agentId)?.role === 'input'

  const pipelineNodes: PipelineNode[] = workflow.agents.map(({ agent }) => ({
    id: agent.id,
    name: agent.name,
    subtitle: META[agent.id].subtitle,
    iconName: META[agent.id].iconName,
    status: statusOf(iid(agent.id)),
    handoffsTo: agent.handoffs ?? [],
  }))

  const openAgent = openId ? workflow.agents.find((a) => iid(a.agent.id) === openId) : undefined

  // Every workflow × agent mounted idle for the whole session (keyed by instance id),
  // so a cross-workflow delivery target always exists — no mount-then-run race.
  const allRuntimes = useMemo(
    () =>
      workflows.flatMap((wf) =>
        wf.agents.map(({ agent }) => ({ id: instanceId(wf.id, agent.id), def: agent }))
      ),
    []
  )

  const switchWorkflow = (id: string) => {
    setOpenId(null)
    setUnread((u) => ({ ...u, [id]: 0 }))
    setActiveWorkflowId(id)
  }

  return (
    <>
      {allRuntimes.map(({ id, def }) => (
        <AgentRuntime key={id} def={{ ...def, id }} onChange={onAgentChange} />
      ))}

      <WorkflowSwitcher
        workflows={workflows}
        activeId={activeWorkflowId}
        unread={unread}
        onSelect={switchWorkflow}
      />

      <div className='workspace-body'>
        <PipelineColumn nodes={pipelineNodes} onOpen={(agentId) => setOpenId(iid(agentId))} />
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
                const a = agentOf(iid(agent.id))
                return (
                  <AgentCard
                    key={agent.id}
                    name={agent.name}
                    subtitle={META[agent.id].subtitle}
                    iconName={META[agent.id].iconName}
                    status={statusOf(iid(agent.id))}
                    canStart={canStart(agent.id)}
                    onStart={() => a && void copilotkit.runAgent({ agent: a })}
                    onOpen={() => setOpenId(iid(agent.id))}
                  />
                )
              })}
            </div>
          </div>
        </div>

        {openAgent && agentOf(iid(openAgent.agent.id)) && (
          <AgentModal
            agent={agentOf(iid(openAgent.agent.id))}
            title={openAgent.agent.name}
            iconName={META[openAgent.agent.id].iconName}
            status={statusOf(iid(openAgent.agent.id))}
            renderToolCall={renderToolCall}
            loading={statusOf(iid(openAgent.agent.id)) === 'running'}
            canStart={canStart(openAgent.agent.id)}
            intro={META[openAgent.agent.id].intro}
            notes={handoffNotes[iid(openAgent.agent.id)] ?? []}
            onOpenWorkflow={switchWorkflow}
            onStart={() => {
              const a = agentOf(iid(openAgent.agent.id))
              if (a) void copilotkit.runAgent({ agent: a })
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
