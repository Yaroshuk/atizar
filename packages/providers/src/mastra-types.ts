import type { GateResolution } from '@atizar/core'

// One Mastra fullStream chunk we read. Structural (NOT @mastra/core's type) so the package
// has zero Mastra dependency — same discipline as claude-stream reading NDJSON. Fields are
// read defensively: workflow-level wrapping may nest the agent payload, so the mapper checks
// both `payload.text` and `text`, etc.
export interface MastraChunk {
  type: string // 'text-delta' | 'tool-call' | 'tool-call-input-streaming-delta' | 'tool-result' | 'finish' | 'error' | …
  payload?: {
    text?: string
    toolCallId?: string
    toolName?: string
    args?: unknown
    argsTextDelta?: string
    result?: unknown
    error?: unknown
  }
  // Some chunk shapes flatten these to the top level; the mapper reads payload first, then root.
  text?: string
  toolCallId?: string
  toolName?: string
  args?: unknown
  error?: unknown
}

export type MastraRunResult =
  | { status: 'suspended' }
  | { status: 'completed' }
  | { status: 'failed'; error: string }

export interface MastraRun {
  stream: AsyncIterable<MastraChunk>
  result: Promise<MastraRunResult>
  // CAUTION (a): cancel the in-flight run. The provider calls this in its generator `finally`,
  // so the RunObserver's existing cancel (iterator.return()) reaches Mastra.
  abort(): void
}

// Injected by the server (the spawn-injection pattern). `inputData` is provider-built and
// opaque to the package; the server adapter decodes it. `runId` is caller-supplied so AG-UI
// runId === Mastra runId (native resume targets it).
export interface MastraRunner {
  start(runId: string, inputData: Record<string, unknown>): MastraRun
  resume(runId: string, resolution: GateResolution): MastraRun
}
