import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { EventType, type BaseEvent, type RunAgentInput } from '@ag-ui/client'
import {
  resolvedApprovalCount,
  type Provider,
  type Message,
  type ResumeHandle,
  type GateResolution,
} from '@atizar/core'

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
  // Phone: requires a real separator (space, paren, or leading +) so pure
  // digit-hyphen runs — UUID fragments, version numbers, ISO dates — don't match.
  ['phone', /(?<![\d-])(?!\d{4}-\d{2}-\d{2})(?=[\d ()+-]*[ ()+])[(]?\+?\d[\d ()-]{7,}\d(?!\d)/g],
  // Secret: token-shaped (sk-… incl. sk-ant-/sk-proj- hyphens, ghp_…, AIza…, raw
  // JWTs) OR keyword-tagged (api_key= / Authorization: …). Keyword branch keeps
  // the :/= requirement so plain prose ("the secret to success") is NOT flagged.
  // Every finding's snippet is capped at 120 chars at the push site so a long
  // token/JWT doesn't bloat the report.
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
        out.push({ line: i + 1, kind, snippet: match[0].slice(0, 120) })
      }
    }
  })
  return out
}

async function readFileOrNull(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null // no recording yet
    throw err // a real error (e.g. EACCES) must surface, not be treated as "empty"
  }
}

// One JSONL file per agent key, holding every step. readStep returns null when
// the step has no recorded events (→ caller records it). writeStep replaces just
// that step's lines, leaving other steps intact.
export class CassetteStore {
  constructor(
    private readonly dir: string,
    private readonly key: string
  ) {
    if (/[/\\]|\.\./.test(key)) {
      throw new Error(`Invalid cassette key (path separators not allowed): ${key}`)
    }
  }

  private file(): string {
    return join(this.dir, `${this.key}.jsonl`)
  }

  async readStep(step: number): Promise<BaseEvent[] | null> {
    const text = await readFileOrNull(this.file())
    if (text === null) return null
    const events = eventsForStep(text, step)
    return events.length > 0 ? events : null
  }

  async writeStep(step: number, events: BaseEvent[]): Promise<void> {
    if (events.length === 0) return // nothing captured → don't clobber/empty the step
    const existing = (await readFileOrNull(this.file())) ?? ''
    const kept = dropStep(existing, step)
    const added = events.map((e) => encodeLine(step, e)).join('\n')
    const body = [kept, added].filter((s) => s.length > 0).join('\n')
    await mkdir(this.dir, { recursive: true })
    // Atomic write: a Ctrl-C mid-write must not corrupt an existing cassette.
    const tmp = `${this.file()}.${step}.tmp`
    await writeFile(tmp, body + '\n', 'utf8')
    await rename(tmp, this.file())
  }
}

export type RecordReplayMode = 'replay' | 'record' | 'demo'

// Demo-only replay pacing: recorded events fire instantly, so a demo replays in a blink and the
// viewer never sees the pipeline progress. In 'demo' mode we sleep before each "visible" boundary
// (a new tool call / a new message) and a tick between streaming deltas, so the board animates as
// if the agent were working live. Tunable via env; ZERO effect outside demo mode (tests replay at
// full speed). DEMO_PACE_MS=0 disables.
const DEMO_PACE_MS = Number.isFinite(Number(process.env.DEMO_PACE_MS))
  ? Number(process.env.DEMO_PACE_MS)
  : 850
const DEMO_DELTA_MS = Number.isFinite(Number(process.env.DEMO_DELTA_MS))
  ? Number(process.env.DEMO_DELTA_MS)
  : 28

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

async function paceDemoEvent(event: BaseEvent): Promise<void> {
  if (DEMO_PACE_MS <= 0) return
  const t = event.type
  const boundary = t === EventType.TOOL_CALL_START || t === EventType.TEXT_MESSAGE_START
  await sleep(boundary ? DEMO_PACE_MS : DEMO_DELTA_MS)
}

// Replay a recorded step, paced in demo mode so the run is watchable.
async function* yieldRecorded(
  events: BaseEvent[],
  mode: RecordReplayMode
): AsyncIterable<BaseEvent> {
  for (const event of events) {
    if (mode === 'demo') await paceDemoEvent(event)
    yield event
  }
}

// Reads the dev toggle. unset → null (no wrapping, pure production path).
// "record" → force-overwrite; anything else truthy ("1"/"replay") → auto
// (replay a step if recorded, else record it).
export function recordReplayMode(): RecordReplayMode | null {
  const v = process.env.DEV_RECORD_REPLAY
  if (!v) return null
  return v === 'record' ? 'record' : 'replay'
}

// Wraps a real provider. Per run: step = resolved-approval count. In "replay"
// mode a recorded step is yielded without touching the real provider; a miss (or
// "record" mode) calls the real provider, passes every event through unchanged,
// and writes that step to disk.
export function withRecordReplay(
  provider: Provider,
  opts: {
    key: string
    approvalNames: readonly string[]
    dir: string
    mode: RecordReplayMode
    // Optional per-run cassette key. When it returns a string, THAT names the cassette file for
    // this run instead of the fixed `key` — so two instances of one agent (same `key`) can replay
    // distinct recordings (e.g. one reply cassette per sender). Returns undefined ⇒ fall back to
    // `key`. The framework only calls it; the discriminator (what makes a run distinct) is the
    // caller's policy.
    keyOf?: (input: RunAgentInput) => string | undefined
  }
): Provider {
  const base: Provider = {
    async *run(input: RunAgentInput): AsyncIterable<BaseEvent> {
      const messages = (input.messages ?? []) as Message[]
      const step = resolvedApprovalCount(messages, opts.approvalNames)
      const store = new CassetteStore(opts.dir, opts.keyOf?.(input) ?? opts.key)

      if (opts.mode === 'replay' || opts.mode === 'demo') {
        const recorded = await store.readStep(step)
        if (recorded) {
          yield* yieldRecorded(recorded, opts.mode)
          return
        }
        if (opts.mode === 'demo') {
          throw new Error(
            `DemoCassetteMissing: ${opts.key} step ${step} (demo-cassettes/${opts.key}.jsonl)`
          )
        }
      }

      const captured: BaseEvent[] = []
      for await (const event of provider.run(input)) {
        captured.push(event)
        yield event
      }
      // Write only on normal completion — a provider throw unwinds past here, leaving the cassette clean.
      await store.writeStep(step, captured)
    },
  }

  // Wrap resume() with the SAME auto-semantics, keyed one past the resolved-approval
  // count of the handle's input (the gate being resolved is the NEXT step). Only when
  // the underlying provider has a resume — a resume-less provider stays resume-less.
  if (!provider.resume) return base
  const resume = provider.resume.bind(provider)
  return {
    ...base,
    async *resume(handle: ResumeHandle, resolution: GateResolution): AsyncIterable<BaseEvent> {
      const messages = (handle.input?.messages ?? []) as Message[]
      const step = resolvedApprovalCount(messages, opts.approvalNames) + 1
      const store = new CassetteStore(
        opts.dir,
        (handle.input ? opts.keyOf?.(handle.input) : undefined) ?? opts.key
      )

      if (opts.mode === 'replay' || opts.mode === 'demo') {
        const recorded = await store.readStep(step)
        if (recorded) {
          yield* yieldRecorded(recorded, opts.mode)
          return
        }
        if (opts.mode === 'demo') {
          throw new Error(
            `DemoCassetteMissing: ${opts.key} step ${step} (demo-cassettes/${opts.key}.jsonl)`
          )
        }
      }

      const captured: BaseEvent[] = []
      for await (const event of resume(handle, resolution)) {
        captured.push(event)
        yield event
      }
      await store.writeStep(step, captured)
    },
  }
}
