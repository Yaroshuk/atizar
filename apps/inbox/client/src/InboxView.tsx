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
import { useAgentStatus } from './useAgentStatus'
import { qualifierAgent, replyAgent } from '../../core/inbox.agent'
import { encodeHandoff, type HandoffPayload } from '../../core/handoff'
import type { Message } from '../../core/messages'

// The consumer desktop: one card per agent + a conversation modal. Two agents are
// known statically (qualifier, reply), so they are wired explicitly rather than
// mapped — N-agent mapping over a registry is deferred to the framework phase.
// Must render inside <CopilotKit> (see App).
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

  return (
    <div style={{ display: 'flex', gap: 16, padding: 24, flexWrap: 'wrap' }}>
      <AgentCard
        name={qualifierAgent.name}
        status={qualifierStatus}
        onStart={() => void copilotkit.runAgent({ agent: qualifier })}
        onOpen={() => setOpenId(qualifierAgent.id)}
      />
      <AgentCard
        name={replyAgent.name}
        status={replyStatus}
        onStart={() => void copilotkit.runAgent({ agent: reply })}
        onOpen={() => setOpenId(replyAgent.id)}
      />
      {openId === qualifierAgent.id && (
        <AgentModal
          agent={qualifier}
          title={qualifierAgent.name}
          renderToolCall={renderToolCall}
          loading={qualifierStatus === 'running'}
          onClose={() => setOpenId(null)}
        />
      )}
      {openId === replyAgent.id && (
        <AgentModal
          agent={reply}
          title={replyAgent.name}
          renderToolCall={renderToolCall}
          loading={replyStatus === 'running'}
          onClose={() => setOpenId(null)}
        />
      )}
    </div>
  )
}
