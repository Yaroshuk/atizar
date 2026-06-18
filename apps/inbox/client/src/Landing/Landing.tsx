import { Link } from 'react-router-dom'
import { Starfield } from './Starfield'
import s from './Landing.module.scss'

const GITHUB_URL = 'https://github.com/Yaroshuk/atizar'

type Feature = { label: string; title: string; body: string }

// Developer-facing value props — the four claims the code actually wins on.
const FEATURES: Feature[] = [
  {
    label: 'AGENTIC-FIRST',
    title: "You don't write the pipeline.",
    body: 'The coding agent plans, writes, and tests your workflow — guided by skills baked into the framework. Test-driven by default. You point it and stay in control.',
  },
  {
    label: 'SAFE BY CODE',
    title: 'Approval is a guarantee, not a prompt.',
    body: 'Effect tools bind to server-side functions the model never sees, and run through an action ledger exactly once — only after a human approves. A jailbroken prompt still cannot fire an action.',
  },
  {
    label: 'TWO FACES',
    title: 'Node editors fail everyone.',
    body: 'Too low-ceiling for a developer — faster to open an editor. Too noisy for an operator — they just want buttons. atizar gives each its own face: real TypeScript for you, a clean board for them.',
  },
  {
    label: 'ENGINE-AGNOSTIC',
    title: 'Swap the runtime, keep the code.',
    body: 'One thin contract under everything. The same workflow runs on Mastra and claude-cli, proven by a provider conformance suite — not just claimed.',
  },
]

const CODE = `import { defineAgent } from '@atizar/core'

export const reply = defineAgent({
  id: 'reply',
  provider: 'claude-cli',
  instructions: 'Draft a reply to the latest email.',
  readonly: ['get_latest_email'],   // pure reads, no side effects
  tools: ['get_latest_email', 'saveDraft'],
  approvals: ['saveDraft'],          // opens a gate — pauses for a human
  effects: ['saveDraft'],            // the SERVER runs this once approved
  renders: { saveDraft: 'ApprovalDialog' },
})`

export const Landing = () => (
  <div className={s.page}>
    <Starfield />

    <div className={s.content}>
      <header className={s.nav}>
        <span className={s.brand}>
          <img className={s.brandMark} src='/atizar-mark.svg' alt='' aria-hidden='true' />
          atizar
        </span>
        <nav className={s.navLinks}>
          <a href={GITHUB_URL} className={s.navGithub} target='_blank' rel='noreferrer'>
            GitHub ↗
          </a>
          <Link to='/demo' className={s.navCta}>
            Open demo →
          </Link>
        </nav>
      </header>

      <main className={s.hero}>
        <div className={s.ember}>
          <img className={s.emberMark} src='/atizar-mark.svg' alt='atizar' />
        </div>
        <p className={s.eyebrow}>OPEN-SOURCE · TYPESCRIPT · HUMAN-IN-THE-LOOP</p>
        <h1 className={s.headline}>
          Agentic automations you can
          <br />
          actually <em>ship to a client</em>.
        </h1>
        <p className={s.sub}>
          The agent reads, drafts, and proposes. A human approves what matters. The server — never
          the model — runs the approved action. And you write almost no code.
        </p>
        <div className={s.actions}>
          <Link to='/demo' className={s.cta}>
            Open the live demo
          </Link>
          <a href={GITHUB_URL} className={s.ghost} target='_blank' rel='noreferrer'>
            Star on GitHub
          </a>
        </div>
        <p className={s.tagline}>Developer builds · Human directs · Agent runs</p>
      </main>

      <section className={s.codeWrap} aria-label='The smallest thing you write'>
        <div className={s.code}>
          <div className={s.codeBar}>
            <span className={s.dot} />
            <span className={s.dot} />
            <span className={s.dot} />
            <span className={s.codeFile}>reply.agent.ts</span>
          </div>
          <pre className={s.codeBody}>
            <code>{CODE}</code>
          </pre>
        </div>
        <p className={s.codeNote}>
          The agent drafts and proposes; the human approves; the server saves the draft.
          <br />
          The model never sends — it can't.
        </p>
      </section>

      <section className={s.features} aria-label='Why atizar'>
        {FEATURES.map((f, i) => (
          <article
            key={f.title}
            className={s.card}
            style={{ animationDelay: `${0.1 + i * 0.07}s` }}
          >
            <span className={s.cardLabel}>{f.label}</span>
            <h2 className={s.cardTitle}>{f.title}</h2>
            <p className={s.cardBody}>{f.body}</p>
          </article>
        ))}
      </section>

      <section className={s.demoBox}>
        <p className={s.demoBoxText}>
          This is a demo running on <strong>pre-recorded steps</strong> — no credentials, no live
          calls. To run it on your own real data, follow the setup guide.
        </p>
        <div className={s.demoBoxActions}>
          <Link to='/demo' className={s.cta}>
            Open the demo
          </Link>
          <a href={GITHUB_URL} className={s.ghost} target='_blank' rel='noreferrer'>
            Setup guide on GitHub ↗
          </a>
        </div>
      </section>

      <footer className={s.footer}>
        <span className={s.footerBrand}>atizar</span>
        <span className={s.footerDim}>to stoke a fire — keep it alive</span>
        <a href={GITHUB_URL} className={s.footerLink} target='_blank' rel='noreferrer'>
          GitHub ↗
        </a>
      </footer>
    </div>
  </div>
)
