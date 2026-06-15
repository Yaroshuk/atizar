import s from './SourcePanel.module.scss'

// Keys that are plumbing, not human-meaningful source content — hidden from the panel (applied at
// every level). `origin` is the handoff routing id; `threadId`/`messageId` are Gmail handles (ids,
// not content).
const HIDDEN_KEYS: ReadonlySet<string> = new Set(['origin', 'threadId', 'messageId'])

type SourcePanelProps = {
  // The untrusted source the agent reacted to (the WorkItem payload / the incoming email or
  // ticket). Rendered as flat label/value pairs — NEVER as markdown or HTML (this is the
  // prompt-injection surface; it must read inert).
  source: Record<string, unknown>
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

// Flatten ONE level: a nested object (e.g. payload `{ email: {...} }`) contributes its inner
// fields directly, so the panel shows from/subject/snippet — never a raw JSON blob. Deeper
// nesting / arrays fall back to a string. Plumbing ids (HIDDEN_KEYS) are dropped at every level.
const flatten = (source: Record<string, unknown>): [string, string][] => {
  const out: [string, string][] = []
  const push = (k: string, v: unknown) => {
    if (HIDDEN_KEYS.has(k) || v === undefined || v === null || v === '') return
    out.push([k, typeof v === 'string' ? v : JSON.stringify(v)])
  }
  for (const [key, value] of Object.entries(source)) {
    if (isPlainObject(value)) for (const [k, v] of Object.entries(value)) push(k, v)
    else push(key, value)
  }
  return out
}

// The daily human-oversight surface AND the prompt-injection defense: show the original
// untrusted email/ticket NEXT TO the editable draft, visibly flagged as untrusted external
// content (muted container + explicit label). Workflow-agnostic — it renders whatever payload
// shape the work item carried; userland decides where to place it.
export const SourcePanel = ({ source }: SourcePanelProps) => {
  const fields = flatten(source)
  if (fields.length === 0) return null
  return (
    <div className={s.panel}>
      <div className={s.label}>Untrusted external content</div>
      <dl className={s.fields}>
        {fields.map(([key, value]) => (
          <div className={s.field} key={key}>
            <dt className={s.key}>{key}</dt>
            <dd className={s.value}>{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}
