import { Link } from 'react-router-dom'
import s from './Landing.module.scss'

type Feature = {
  label: string
  title: string
  body: string
}

// The feature sellers. Order = perceived importance for the inbound-automation story:
// trust (HITL) and safety lead, then the framework's distinctive mechanisms.
const FEATURES: Feature[] = [
  {
    label: 'TRUST',
    title: 'Human-in-the-loop by design',
    body: 'Every consequential step pauses for a person. Approve, reject, or edit — nothing meaningful fires on its own, and everything is audited.',
  },
  {
    label: 'SAFETY',
    title: 'Safe by design',
    body: 'The model proposes and opens a gate; the server executes the approved action. Effects are server-executed behind approval — never run by the agent directly.',
  },
  {
    label: 'CONFIG',
    title: 'Config-as-data',
    body: 'Agents, tools, and operator-tunable values are declared data — not magic buried in prompt prose. Re-tune and re-theme without touching code.',
  },
  {
    label: 'UI',
    title: 'Generative UI',
    body: 'Agents render real cards — drafts, summaries, routing verdicts — into a board your client actually reads. Not a wall of chat text.',
  },
  {
    label: 'PROVIDERS',
    title: 'Swappable providers',
    body: 'Claude, Mastra, or your own runtime behind one thin contract. Swappability is proven with unlike providers out of the box, not just declared.',
  },
  {
    label: 'STATE',
    title: 'Server-authoritative',
    body: 'Durable work-item state lives in Postgres with one owner of every transition. Stop or cancel any run — per agent instance or per workflow.',
  },
]

export const Landing = () => (
  <div className={s.page}>
    <header className={s.nav}>
      <span className={s.mark}>atizar</span>
      <Link to='/demo' className={s.navCta}>
        Open demo →
      </Link>
    </header>

    <main className={s.hero}>
      <p className={s.eyebrow}>OPEN-SOURCE AGENT-AUTOMATION FRAMEWORK</p>
      <h1 className={s.headline}>
        Ship agent automations
        <br />
        your clients can <em>actually trust</em>.
      </h1>
      <p className={s.sub}>
        Inbound flows — email, leads, tickets — qualified by agents, approved by a human, executed
        by the server. Code for the engineer; a polished board for the client.
      </p>
      <div className={s.actions}>
        <Link to='/demo' className={s.cta}>
          Open demo
        </Link>
        <span className={s.note}>Live email-inbox pipeline · recorded cassette · no signup</span>
      </div>
    </main>

    <section className={s.features} aria-label='Features'>
      {FEATURES.map((f, i) => (
        <article key={f.title} className={s.card} style={{ animationDelay: `${0.15 + i * 0.06}s` }}>
          <span className={s.cardLabel}>{f.label}</span>
          <h2 className={s.cardTitle}>{f.title}</h2>
          <p className={s.cardBody}>{f.body}</p>
        </article>
      ))}
    </section>

    <footer className={s.footer}>
      <span>ATIZAR</span>
      <span className={s.footerDim}>The human starts, steers, and approves.</span>
    </footer>
  </div>
)
