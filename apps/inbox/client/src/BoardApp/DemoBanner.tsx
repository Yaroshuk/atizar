import s from './DemoBanner.module.scss'

const GITHUB_URL = 'https://github.com/Yaroshuk/atizar'

// A thin notice shown only in demo mode: this board runs on pre-recorded data, with a link to the
// full project. App-side (demo policy), not part of the framework header.
export const DemoBanner = () => (
  <div className={s.banner}>
    <span className={s.dot} aria-hidden='true' />
    <span className={s.text}>
      This is a live demo running on <strong>pre-recorded steps</strong> — no credentials, no real
      email. To see everything and run it on your own data,
    </span>
    <a className={s.link} href={GITHUB_URL} target='_blank' rel='noreferrer'>
      open the project on GitHub ↗
    </a>
  </div>
)
