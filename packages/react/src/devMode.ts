// Dev mode toggle. The agent thread is a CONSUMER surface — by default it shows only
// the generative-UI cards (LeadCard, TriageCard, …) and hides internal plumbing
// (data-fetch tools like list_my_tickets / get_latest_email). Dev mode reveals every
// raw tool-call chip for debugging.
//
// Toggle via the URL: `?dev=1` turns it on, `?dev=0` off; the choice persists in
// localStorage so it survives navigations. No build flag — works in any deployment.
const KEY = 'aiw.dev'

function read(): boolean {
  if (typeof window === 'undefined') return false
  const param = new URLSearchParams(window.location.search).get('dev')
  if (param !== null) {
    const on = param !== '0' && param !== 'false'
    try {
      window.localStorage.setItem(KEY, on ? '1' : '0')
    } catch {
      // ignore storage failures (private mode etc.) — fall back to the URL value
    }
    return on
  }
  try {
    return window.localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

// Resolved once at module load — dev mode is a session-level switch, not reactive.
export const isDevMode = read()
