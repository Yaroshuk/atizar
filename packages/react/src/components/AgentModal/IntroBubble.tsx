import clsx from 'clsx'
import { Icon } from '../Icon/Icon'
import s from './AgentModal.module.scss'

// The AGENT-static opening message ("Reading the email and drafting a reply…") rendered as an
// assistant chat bubble. It is shown ONCE per instance thread (by InstanceView) — never per run —
// and once at the head of the idle type-view (via ThreadItems). One source for the bubble markup.
export const IntroBubble = ({ text }: { text: string }) => (
  <div className={clsx(s.threadItem, s.bubbleRow)}>
    <span className={s.agentGlyph}>
      <Icon name='sparkle' size={15} />
    </span>
    <div className={clsx(s.bubble, s.intro)}>{text}</div>
  </div>
)
