# Provider contract v2 — design

> **Status: design (approved).** Beta build order **step 1** — lands in `@atizar/core` +
> `@atizar/providers` BEFORE any PipelineService code. Source of truth for the locked
> decisions: `docs/pipeline-updated-3.md` §1.4 + the HANDOFF build order. This spec only
> consolidates those into a buildable step-1 surface; it introduces no new architectural
> decisions.

## 1. Goal

Add the two contract capabilities the server-authoritative spine (steps 2–6) will depend on,
and prove them with a provider-agnostic conformance suite — without disturbing the live app.

1. **Explicit `resume?(handle, resolution)`** on the `Provider` seam. Gate-resolution becomes a
   first-class call instead of being re-detected from message history inside `run()`.
2. **A provider-agnostic `GATE_OPENED` signal** in the AG-UI event vocabulary. Gate detection
   moves out of "spot the approval tool call in the stream" and into the contract.
3. **A conformance suite** (`runProviderConformance`) exercised against `claude-cli` (fake spawn)
   and the mock now, with a reserved slot for Mastra at step 5.

### Non-goals (explicitly deferred, per the locked build order)

- The server / RunObserver / StateStore that will *call* `resume()` — steps 2–3. In step 1
  `resume()` has no production caller; the conformance suite is its only exerciser. This is by
  design ("contract BEFORE PipelineService code").
- Re-keying record/replay to the store's gate-resolution count — **step 5**. Untouched here.
- The Mastra provider — **step 5**. Only the conformance slot is reserved.
- Any change to the live `@copilotkit/*` client. It keeps running on the message-history loop as
  the dev surface until **step 6**.

## 2. Coexistence model (locked: additive)

`run(input)` stays **back-compatible**: it still detects resume from the message history
(`approvalResolved`) so the existing client keeps working unchanged. We *add* `resume()` and
`GATE_OPENED` alongside it. The new `GATE_OPENED` event is an additional `CUSTOM` event in the
stream; the old client does not consume it and ignores it. No forced cassette wipe: old cassettes
replay as before (they simply lack the new event); new recordings include it.

## 3. `@atizar/core` additions

### 3.1 `resume?` on `Provider`

```ts
export interface Provider {
  run(input: RunAgentInput): AsyncIterable<BaseEvent>
  // Optional v2 capability. Resumes a run that suspended at a gate. The provider OWNS the
  // resume mechanics (the orchestrator never hard-codes re-prime): claude-cli implements it as
  // kill-and-re-prime from the transcript + verbatim artifact; Mastra implements it as native
  // resume by runId against its own snapshot store. Absent ⇒ provider has no resume capability
  // (the orchestrator falls back to the message-history re-run path until step 6).
  resume?(handle: ResumeHandle, resolution: GateResolution): AsyncIterable<BaseEvent>
}

// What the orchestrator hands back to resume a suspended run. Both fields are always present;
// each provider reads the slice it needs. claude-cli re-primes from `input` (transcript +
// the approved artifact in the resolution); Mastra resumes by `runId` and ignores `input`.
export interface ResumeHandle {
  runId: string
  input: RunAgentInput
}

// The human's decision at a gate. `form` is the approved/edited artifact (byte-verbatim — it
// becomes the effect arguments at step 4); `comment` seeds the future revise loop.
export interface GateResolution {
  gateId: string
  decision: 'approved' | 'rejected'
  form?: Record<string, unknown>
  comment?: string
}
```

`ResumeHandle` is deliberately a **transparent struct**, not an opaque provider-minted token: a
stateless claude-cli has no live process to hold a token against, so the handle must already
carry the transcript. If a provider later needs a private token, it can be added as an optional
field without breaking callers.

### 3.2 `GATE_OPENED` signal

Carried as an AG-UI `CUSTOM` event (keeps us inside the AG-UI vocabulary; survives record/replay
as an ordinary `BaseEvent`; unknown to — and ignored by — the old client).

```ts
export const GATE_OPENED = 'GATE_OPENED' as const

// zod-validated payload (CUSTOM.value is `any`; we own the type).
export const GateOpenedValueSchema = z.object({
  gateKind: z.literal('approval'),          // only 'approval' in the beta; reserves the field
  toolName: z.string(),                      // the approval tool that opened the gate
  toolCallId: z.string(),                    // correlates with the TOOL_CALL_* events
  proposedArtifact: z.record(z.unknown()),   // the approval tool's args = the agent's proposal
})
export type GateOpenedValue = z.infer<typeof GateOpenedValueSchema>

// Helper that builds the BaseEvent (so providers don't hand-roll the CUSTOM envelope).
export function gateOpened(value: GateOpenedValue): BaseEvent
// Helper the consumer side uses to recognize + parse a gate signal from a BaseEvent.
export function readGateOpened(event: BaseEvent): GateOpenedValue | null
```

`proposedArtifact` + `toolCallId` are exactly what the RunObserver (step 2) will copy into the
Gate record. Emitting them now means the gate's audit data exists in the stream before the
consumer that stores it.

**Why no `resumeHandle` in the event:** `GATE_OPENED` carries only what the consumer does *not*
otherwise have. The orchestrator already holds `{ runId, input }` (it dispatched the run), so it
constructs the `ResumeHandle` itself when it calls `resume()`. The provider — not the
orchestrator and not the event — owns what to *do* with that handle. This also lets the emitter
(`claude-stream`) produce a complete signal from data it already has (tool name, id, args),
without reaching for the runId/input it never sees.

### 3.3 Conformance suite

`runProviderConformance(makeProvider, opts)` — a function that, given a way to construct a
provider for a fixed scenario, asserts the v2 invariants. Lives in `@atizar/core` (so any
provider package can import it) and is *invoked* from each provider's own test file.

Invariants asserted:

1. **Turn-1 opens a gate.** A run that reaches the approval tool emits exactly one `GATE_OPENED`
   whose `toolName` ∈ the agent's approvals and whose `toolCallId` matches the preceding
   `TOOL_CALL_*` events; the stream ends after it (the suspend point).
2. **`resume(approved)` completes without re-gating.** Resuming an approved gate runs to normal
   completion and emits **no** second `GATE_OPENED` for the same gate.
3. **`resume(rejected)` terminates cleanly.** No effect-shaped continuation; the run ends.
4. **Surface filtering holds.** Only declared surface tools appear as `TOOL_CALL_*`; internal
   tools do not.
5. **Contiguous text shares one `messageId`.** (Regression guard for the delta-split bug.)

`opts` carries the scenario knobs (approval names, a scripted turn) so the same suite drives the
mock directly and `claude-cli` over a fake spawn. The Mastra row is a reserved, `.skip`-ed (or
conditionally-registered) case until step 5.

## 4. `@atizar/providers` changes

### 4.1 `claude-stream`

Emit `GATE_OPENED` immediately before the `return` that currently fires on an approval tool call
(both the complete-message path at the `isApproval(...) return` and the streaming
`content_block_stop` path). The existing `TOOL_CALL_END`-then-caller-kills behavior is unchanged
— the gate event is **additive** context, not a replacement, so the old client still pauses
exactly as today. The approval tool's args (already parsed for `TOOL_CALL_ARGS`) become
`proposedArtifact`.

### 4.2 `claude-cli-provider`

- Extract the current kill-and-re-prime logic out of `run()`'s resume branch into a shared
  internal helper `primeAndStream(prompt, ...)`.
- `run()` keeps its message-history resume detection (back-compat); the `GATE_OPENED` event is
  emitted by `claude-stream` (§4.1) — `run()` needs no change to carry it.
- Implement `resume(handle, resolution)`: build the resume prompt from
  `handle.input` + `resolution.form` (the verbatim approved artifact) via the existing
  `PromptStrategy.buildResume`, then `primeAndStream`. A `rejected` resolution primes a
  "the human rejected this" continuation (no effect).

### 4.3 `mock-provider`

- Emit `GATE_OPENED` after the `saveDraft` approval tool call on turn 1.
- Implement `resume()` returning the post-approval text (the same "Draft saved" completion it
  emits today on the message-detected resume path).
- This is the reference implementation the conformance suite pins to.

## 5. What is NOT touched

`record-replay.ts` (keying stays `resolvedApprovalCount`), `build-agent.ts`, the server, the
client, `defineAgent` (no `effects` field yet — that is step 4). `resolvedApprovalCount` and
`approvalResolved` stay (still used by `run()` and record/replay).

## 6. Testing & verification

- `yarn typecheck` + `yarn test` green; `yarn lint` + `yarn format:check` green.
- Conformance suite passes against mock + claude-cli (fake spawn).
- New unit tests: `gateOpened`/`readGateOpened` round-trip + zod rejection of a bad payload;
  `claude-stream` emits `GATE_OPENED` with the right `toolCallId`/`proposedArtifact`;
  `claude-cli` `resume()` re-primes from the handle.
- **Live smoke (not a new flow, just a no-regression check):** `yarn dev` + one HITL run on the
  existing client — confirm the added `GATE_OPENED` event does not disturb the current
  pause/approve/resume loop. (Per the project rule to browser-verify anything the unit layer
  can't catch.)

## 7. Risks

- **Stream shape change breaks a recorded cassette consumer.** Mitigated: the only cassette
  consumer is the old client, which ignores unknown `CUSTOM` events; old cassettes lack the
  event and still replay. No wipe needed at step 1.
- **`resume()` is dead code until step 3.** Accepted and intended — the conformance suite is its
  contract test; building the contract ahead of its caller is the point of step 1.
- **`ResumeHandle` shape may need a private token later (Mastra).** Mitigated: optional additive
  field; transparent struct does not preclude it.
