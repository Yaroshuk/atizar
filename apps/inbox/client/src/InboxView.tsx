import { useCallback, useRef, useState } from 'react'
import { useCopilotKit, useRenderToolCall } from '@copilotkit/react-core/v2'
import { useInboxActions } from './actions'
import { useGithubActions } from './githubActions'
import { AgentCard } from './components/AgentCard'
import { AgentModal } from './components/AgentModal'
import { AgentRuntime, type AgentHandle } from './components/AgentRuntime'
import { PipelineColumn } from './components/PipelineColumn'
import { WorkflowSwitcher } from './components/WorkflowSwitcher'
import { Icon } from './components/Icon'
import type { PipelineNode } from './pipeline'
import type { Status } from './status'
import { workflows, META } from './workflows'
import { encodeHandoff, type Message } from '@platform/core'

export const InboxView = () => {
  const { copilotkit } = useCopilotKit()
  const [activeWorkflowId, setActiveWorkflowId] = useState(workflows[0].id)
  const [openId, setOpenId] = useState<string | null>(null)
  const [handles, setHandles] = useState<Record<string, AgentHandle>>({})

  const workflow = workflows.find((w) => w.id === activeWorkflowId) ?? workflows[0]

  // Agents that are some other agent's handoff target are launched BY that agent —
  // they get no START button. Computed over the active workflow only.
  const handoffTargets = new Set(workflow.agents.flatMap((a) => a.handoffs ?? []))
  const canStart = (id: string) => !handoffTargets.has(id)

  const onAgentChange = useCallback((id: string, handle: AgentHandle) => {
    setHandles((prev) => {
      const cur = prev[id]
      if (cur && cur.agent === handle.agent && cur.status === handle.status) return prev
      return { ...prev, [id]: handle }
    })
  }, [])

  // Mirror the latest handles into a ref so the (stable) handoff callback always reads
  // fresh agents. requestHandoff MUST be stable: useRenderTool captures its render
  // closure once (its effect deps stringify a function to "[null]", so it never
  // re-runs), so a handles-dependent requestHandoff would freeze the initial empty map
  // and every handoff would silently no-op.
  const handlesRef = useRef(handles)
  handlesRef.current = handles

  // The handoff seam (human trigger). Seed the target run with the payload, launch it,
  // open its modal. Works for both payload shapes — encode is schema-agnostic.
  const requestHandoff = useCallback(
    (targetId: string, payload: unknown) => {
      const target = handlesRef.current[targetId]?.agent
      if (!target) return
      const seed = encodeHandoff(payload) as Message
      target.messages.splice(0, target.messages.length, seed)
      void copilotkit.runAgent({ agent: target })
      setOpenId(targetId)
    },
    [copilotkit]
  )

  // Both workflows' render tools register unconditionally (globally-unique tool names,
  // stable hook order). requestHandoff is stable and accepts either payload shape, so
  // it is passed directly (no inline wrapper, which would defeat the stable identity).
  useInboxActions(requestHandoff)
  useGithubActions(requestHandoff)

  const renderToolCall = useRenderToolCall()

  const statusOf = (id: string): Status => handles[id]?.status ?? 'idle'
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const agentOf = (id: string): any => handles[id]?.agent

  const pipelineNodes: PipelineNode[] = workflow.agents.map((a) => ({
    id: a.id,
    name: a.name,
    subtitle: META[a.id].subtitle,
    iconName: META[a.id].iconName,
    status: statusOf(a.id),
    handoffsTo: a.handoffs ?? [],
  }))

  const openAgentDef = openId ? workflow.agents.find((a) => a.id === openId) : undefined

  return (
    <>
      {/* Hidden hook owners — one per agent in the active workflow. Keyed by id so a
          workflow switch unmounts the old set and mounts the new (hooks reset cleanly). */}
      {workflow.agents.map((a) => (
        <AgentRuntime key={`${workflow.id}:${a.id}`} def={a} onChange={onAgentChange} />
      ))}

      <WorkflowSwitcher
        workflows={workflows}
        activeId={activeWorkflowId}
        onSelect={(id) => {
          setOpenId(null)
          setActiveWorkflowId(id)
        }}
      />

      <div className='workspace-body'>
        <PipelineColumn nodes={pipelineNodes} onOpen={setOpenId} />

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
              {workflow.agents.map((a) => {
                const agent = agentOf(a.id)
                return (
                  <AgentCard
                    key={a.id}
                    name={a.name}
                    subtitle={META[a.id].subtitle}
                    iconName={META[a.id].iconName}
                    status={statusOf(a.id)}
                    canStart={canStart(a.id)}
                    onStart={() => agent && void copilotkit.runAgent({ agent })}
                    onOpen={() => setOpenId(a.id)}
                  />
                )
              })}
            </div>
          </div>
        </div>

        {openAgentDef && agentOf(openAgentDef.id) && (
          <AgentModal
            agent={agentOf(openAgentDef.id)}
            title={openAgentDef.name}
            iconName={META[openAgentDef.id].iconName}
            status={statusOf(openAgentDef.id)}
            renderToolCall={renderToolCall}
            loading={statusOf(openAgentDef.id) === 'running'}
            canStart={canStart(openAgentDef.id)}
            onStart={() => {
              const agent = agentOf(openAgentDef.id)
              if (agent) void copilotkit.runAgent({ agent })
            }}
            onClose={() => setOpenId(null)}
          />
        )}
      </div>
    </>
  )
}
