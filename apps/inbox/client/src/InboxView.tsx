import { useCallback, useRef, useState } from 'react'
import {
  useAgent,
  useCopilotKit,
  UseAgentUpdate,
  useRenderToolCall,
} from '@copilotkit/react-core/v2'
import { useInboxActions } from './actions'
import { AgentCard } from './components/AgentCard'
import { AgentModal } from './components/AgentModal'
import { PipelineColumn } from './components/PipelineColumn'
import { Icon, type IconName } from './components/Icon'
import { useAgentStatus } from './useAgentStatus'
import type { PipelineNode } from './pipeline'
import { qualifierAgent, replyAgent } from '../../agents/inbox.agent'
import { encodeHandoff, type HandoffPayload, type Message } from '@platform/core'

// Per-agent display chrome (icon + one-line subtitle). Lives client-side for now —
// adding subtitle/icon to the core `defineAgent` passport is deferred to the framework
// phase (see spec). Keyed by agent id.
const META: Record<string, { subtitle: string; iconName: IconName }> = {
  [qualifierAgent.id]: { subtitle: 'Reads inbox, qualifies the lead', iconName: 'inbox' },
  [replyAgent.id]: { subtitle: 'Drafts a reply for your approval', iconName: 'pen' },
}

// The consumer desktop: a left Pipeline panel (live runs, tinted + connected) beside a
// right "Your agents" grid + a conversation modal. Two agents are known statically
// (qualifier, reply), so they are wired explicitly rather than mapped — N-agent mapping
// over a registry is deferred to the framework phase. Must render inside <CopilotKit>.
export const InboxView = () => {
  const { copilotkit } = useCopilotKit()
  const [openId, setOpenId] = useState<string | null>(null)

  const { agent: qualifier } = useAgent({
    agentId: qualifierAgent.id,
    updates: [UseAgentUpdate.OnMessagesChanged],
  })
  const { agent: reply } = useAgent({
    agentId: replyAgent.id,
    updates: [UseAgentUpdate.OnMessagesChanged],
  })

  // Keep the latest agent objects reachable from the (stable) handoff callback.
  const agentsRef = useRef<Record<string, typeof reply>>({})
  agentsRef.current[qualifierAgent.id] = qualifier
  agentsRef.current[replyAgent.id] = reply

  // The handoff seam — human trigger today. Mechanism (encode) lives in core, so a
  // future agent-initiated/server trigger reuses it. Seed the target run with the
  // payload, launch it through CopilotKitCore, open its modal.
  const requestHandoff = useCallback(
    (targetId: string, payload: HandoffPayload) => {
      const target = agentsRef.current[targetId]
      if (!target) return
      const seed = encodeHandoff(payload) as Message
      // Fresh handoff run: replace any prior history with just the seed.
      target.messages.splice(0, target.messages.length, seed)
      void copilotkit.runAgent({ agent: target })
      setOpenId(targetId)
    },
    [copilotkit]
  )

  // Register the generative-UI renderers once (renderLead/saveDraft for reply,
  // renderVerdict for the qualifier). renderVerdict's "Draft reply" forwards here.
  useInboxActions(requestHandoff)

  const renderToolCall = useRenderToolCall()
  const qualifierStatus = useAgentStatus(qualifier, qualifierAgent.approvals)
  const replyStatus = useAgentStatus(reply, replyAgent.approvals)

  const pipelineNodes: PipelineNode[] = [
    {
      id: qualifierAgent.id,
      name: qualifierAgent.name,
      subtitle: META[qualifierAgent.id].subtitle,
      iconName: META[qualifierAgent.id].iconName,
      status: qualifierStatus,
      handoffsTo: qualifierAgent.handoffs ?? [],
    },
    {
      id: replyAgent.id,
      name: replyAgent.name,
      subtitle: META[replyAgent.id].subtitle,
      iconName: META[replyAgent.id].iconName,
      status: replyStatus,
      handoffsTo: replyAgent.handoffs ?? [],
    },
  ]

  return (
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
            <AgentCard
              name={qualifierAgent.name}
              subtitle={META[qualifierAgent.id].subtitle}
              iconName={META[qualifierAgent.id].iconName}
              status={qualifierStatus}
              onStart={() => void copilotkit.runAgent({ agent: qualifier })}
              onOpen={() => setOpenId(qualifierAgent.id)}
            />
            <AgentCard
              name={replyAgent.name}
              subtitle={META[replyAgent.id].subtitle}
              iconName={META[replyAgent.id].iconName}
              status={replyStatus}
              onStart={() => void copilotkit.runAgent({ agent: reply })}
              onOpen={() => setOpenId(replyAgent.id)}
            />
          </div>
        </div>
      </div>

      {openId === qualifierAgent.id && (
        <AgentModal
          agent={qualifier}
          title={qualifierAgent.name}
          iconName={META[qualifierAgent.id].iconName}
          status={qualifierStatus}
          renderToolCall={renderToolCall}
          loading={qualifierStatus === 'running'}
          onClose={() => setOpenId(null)}
        />
      )}
      {openId === replyAgent.id && (
        <AgentModal
          agent={reply}
          title={replyAgent.name}
          iconName={META[replyAgent.id].iconName}
          status={replyStatus}
          renderToolCall={renderToolCall}
          loading={replyStatus === 'running'}
          onClose={() => setOpenId(null)}
        />
      )}
    </div>
  )
}
