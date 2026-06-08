import type { BaseEvent } from '@ag-ui/client'

// A cassette file is JSONL: one recorded AG-UI event per line, tagged with its
// step. Step = how many human approvals are already behind us (see
// resolvedApprovalCount). All of one agent's steps live in ONE file.

export function encodeLine(step: number, event: BaseEvent): string {
  return JSON.stringify({ step, event })
}

export function parseLine(line: string): { step: number; event: BaseEvent } | null {
  const trimmed = line.trim()
  if (!trimmed) return null
  try {
    const obj = JSON.parse(trimmed) as { step?: unknown; event?: unknown }
    if (typeof obj.step === 'number' && obj.event) {
      return { step: obj.step, event: obj.event as BaseEvent }
    }
  } catch {
    // not a cassette line
  }
  return null
}

export function eventsForStep(text: string, step: number): BaseEvent[] {
  const out: BaseEvent[] = []
  for (const line of text.split('\n')) {
    const parsed = parseLine(line)
    if (parsed && parsed.step === step) out.push(parsed.event)
  }
  return out
}

// Keep every valid line whose step differs (drops blank/invalid lines too).
export function dropStep(text: string, step: number): string {
  return text
    .split('\n')
    .filter((line) => {
      const parsed = parseLine(line)
      return parsed !== null && parsed.step !== step
    })
    .join('\n')
}

// A heuristic safety-net scan run BEFORE a cassette is ever shared/committed.
// Catches mechanically-detectable PII/secrets (emails, phones, token-shaped or
// keyword-tagged secrets) with line numbers. Names/addresses are NOT reliably
// detectable here — the human is the final reviewer (see the CLAUDE.md rule).
export interface Finding {
  line: number
  kind: 'email' | 'phone' | 'secret'
  snippet: string
}

const PATTERNS: ReadonlyArray<readonly [Finding['kind'], RegExp]> = [
  ['email', /[\w.+-]+@[\w-]+\.[\w.-]+/g],
  // Phone: requires a +, parens, or spacing — and is guarded against ISO dates
  // (e.g. 2024-01-15) so timestamps in cassette JSON don't read as phone numbers.
  ['phone', /(?<![\d-])(?!\d{4}-\d{2}-\d{2})[(]?\+?\d[\d ()-]{7,}\d(?!\d)/g],
  // Secret: token-shaped (sk-… incl. sk-ant-/sk-proj- hyphens, ghp_…, AIza…, raw
  // JWTs) OR keyword-tagged (api_key= / Authorization: …). Keyword branch keeps
  // the :/= requirement so plain prose ("the secret to success") is NOT flagged.
  // Snippet is length-capped so a huge token doesn't produce a 2000-char finding.
  [
    'secret',
    /\b(?:sk-[\w-]{16,}|gh[pousr]_[A-Za-z0-9]{16,}|AIza[A-Za-z0-9_-]{16,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})\b|(?:bearer|authorization|token|api[_-]?key|secret|password)\s*[:=]\s*\S{1,120}/gi,
  ],
]

export function scanCassette(text: string): Finding[] {
  const out: Finding[] = []
  text.split('\n').forEach((line, i) => {
    for (const [kind, re] of PATTERNS) {
      for (const match of line.matchAll(re)) {
        out.push({ line: i + 1, kind, snippet: match[0] })
      }
    }
  })
  return out
}
