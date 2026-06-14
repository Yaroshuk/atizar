import s from './SourcePanel.module.scss'

// Keys that are plumbing, not human-meaningful source content — hidden from the panel.
// `origin` is the handoff routing id; `threadId` is the Gmail thread handle (an id, not content).
const HIDDEN_KEYS: ReadonlySet<string> = new Set(['origin', 'threadId'])

type SourcePanelProps = {
  // The untrusted source the agent reacted to (the WorkItem payload / the incoming email or
  // ticket). Rendered as flat label/value pairs — NEVER as markdown or HTML (this is the
  // prompt-injection surface; it must read inert).
  source: Record<string, unknown>
}

// The daily human-oversight surface AND the prompt-injection defense: show the original
// untrusted email/ticket NEXT TO the editable draft, visibly flagged as untrusted external
// content (muted container + explicit label). Workflow-agnostic — it renders whatever payload
// shape the work item carried; userland decides where to place it.
export const SourcePanel = ({ source }: SourcePanelProps) => {
  const fields = Object.entries(source).filter(
    ([k, v]) => !HIDDEN_KEYS.has(k) && v !== undefined && v !== null && v !== ''
  )
  if (fields.length === 0) return null
  const display = (v: unknown): string => (typeof v === 'string' ? v : JSON.stringify(v))
  return (
    <div className={s.panel}>
      <div className={s.label}>Untrusted external content</div>
      <dl className={s.fields}>
        {fields.map(([key, value]) => (
          <div className={s.field} key={key}>
            <dt className={s.key}>{key}</dt>
            <dd className={s.value}>{display(value)}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}
