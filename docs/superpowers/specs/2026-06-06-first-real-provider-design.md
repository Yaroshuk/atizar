# First Real Provider — `claude-cli` (Claude Code binary subprocess)

Date: 2026-06-06
Status: design approved (decisions made collaboratively; user authorized autonomous build on a branch)

## Goal

Replace the scripted mock with a **real model** behind the existing `Provider`
seam, proving that a real Claude run drives our exact contract:

> turn 1 → assistant text + `renderLead` tool call + `confirmSend` tool call → **HITL pause** →
> resume → short "done" text.

The lead email stays **canned** (hardcoded in the prompt). Real inbox data
(Gmail/MCP) is the *next* phase — out of scope here. This isolates one unknown:
*can a real model, behind `Provider.run`, produce our tool-call + HITL stream?*

## Decisions (and why)

- **Runtime: the `claude` CLI binary as a subprocess**, not the Agent SDK.
  Reason: no Anthropic API key available; the binary authenticates via the
  Claude Code subscription login, the SDK only via `ANTHROPIC_API_KEY`.
- **Custom tools via a stdio MCP server.** The binary can only expose custom
  tools (`renderLead`, `confirmSend`) through an MCP server (`--mcp-config`).
  Tool calls surface in the stream as `mcp__<server>__<tool>`; we strip the
  prefix when mapping to AG-UI so the client sees the bare `renderLead` /
  `confirmSend` it already registered.
- **HITL = detect-and-kill, not the CLI permission prompt.** We do NOT hold a
  process open awaiting a human (that would fight CopilotKit's client-held,
  two-request HITL and our transport). Instead: the `confirmSend` `tool_use`
  appears in stdout *before* execution; on seeing it we emit the AG-UI tool call
  and **kill the subprocess**, ending turn 1 with `confirmSend` unresolved. The
  existing client flow (ApprovalDialog → approve → second POST) is untouched.
- **Resume = stateless re-prime.** On the second request (approval resolved) the
  provider runs a *fresh* `claude -p` whose prompt states the human approved and
  asks for a one-line confirmation. No server-side session state (matches the
  mock's "state lives in the message thread" philosophy). SDK/CLI session-resume
  by id is deferred.
- **Client/transport/passport-contract unchanged.** Only the server-side provider
  and the registry wiring change. `inbox.agent` switches `provider: 'mock'` →
  `'claude-cli'`; the `mock` provider stays in the registry.

## Architecture

```
client (unchanged)  ──POST──▶  server BFF  ──▶  CopilotRuntime
                                                     │ factory: provider.run(input)
                                                     ▼
                                          claudeCliProvider.run(input)
                                          ├─ approvalResolved? ─ no ─▶ firstTurn(input)
                                          │                            spawn `claude -p … --mcp-config inbox-tools`
                                          │                            stdout NDJSON ─▶ mapClaudeStream ─▶ AG-UI events
                                          │                            on confirmSend TOOL_CALL_END ─▶ kill, stop
                                          └─ approvalResolved? ─ yes ─▶ resumeTurn(input)
                                                                       spawn `claude -p "<re-prime>"`
                                                                       text ─▶ TEXT_MESSAGE_CHUNK ─▶ done
                                          (separate process)  inbox-tools MCP server: renderLead, confirmSend
```

## Components (small, single-purpose, testable)

1. **`core/claude-stream.ts` — the pure parser (the testable core).**
   `mapClaudeStream(lines: AsyncIterable<string>, opts: { approvalNames }) :
   AsyncGenerator<BaseEvent>`.
   - Parses each NDJSON line; ignores non-`stream_event` lines (system/init,
     result) except to detect end.
   - `content_block_delta` `text_delta` → `TEXT_MESSAGE_CHUNK`.
   - `content_block_start` `tool_use` → `TOOL_CALL_START` (name = mcp-prefix
     stripped; `toolCallId` = the block's `id`); `input_json_delta` →
     `TOOL_CALL_ARGS`; `content_block_stop` → `TOOL_CALL_END`.
   - **Signals "stop here"** after emitting `TOOL_CALL_END` for an approval tool
     (name ∈ `approvalNames`). Pure: no process handling — it just stops yielding.
   - This is unit-tested with canned NDJSON sequences (no subprocess).

2. **`core/claude-cli-provider.ts` — the `Provider` (impure spawn wrapper).**
   - `createClaudeCliProvider({ agent, approvalNames, spawn? }) : Provider`.
   - `run(input)`: branch on `approvalResolved(messages, approvalNames)`.
     - **firstTurn:** spawn `claude`, feed stdout lines into `mapClaudeStream`,
       `yield*` events; when the generator stops at the approval tool, kill the
       child and return.
     - **resumeTurn:** spawn `claude -p "<re-prime>"`, map text → chunks, return.
   - `spawn` is injectable so tests drive it with a fake child emitting canned
     NDJSON — no real `claude` needed in unit tests.
   - Builds the prompt (instructions + canned lead) and the re-prime prompt.

3. **`mcp/inbox-tools.mjs` — the stdio MCP server (separate process).**
   Plain Node ESM using `@modelcontextprotocol/sdk`. Exposes:
   - `renderLead(id, from, subject, intent)` → returns a trivial ack so the model
     proceeds to `confirmSend`.
   - `confirmSend(leadId, message)` → ack (rarely runs; we kill at the call).
   Launched by the CLI via `--mcp-config`.

4. **Wiring:** `core/inbox.agent.ts` registers `'claude-cli':
   createClaudeCliProvider(...)` and sets the passport `provider` to it; `mock`
   stays registered. A generated `--mcp-config` + `--settings` (allow
   `mcp__inbox__*`, deny built-ins) point at `inbox-tools.mjs`.

## CLI invocation (verified against current docs)

```
claude --bare -p "<prompt>" \
  --mcp-config <cfg.json> --settings <perms.json> \
  --append-system-prompt "<rules>" \
  --output-format stream-json --verbose --include-partial-messages
```
- `perms.json`: `{ "permissions": { "allow": ["mcp__inbox__*"], "deny": ["Bash","Edit","Write","WebFetch","WebSearch"] } }`
- Auth: subscription login; ensure `ANTHROPIC_API_KEY` is **unset** so it doesn't
  override to (absent) API billing.

## Data flow / event mapping

| stream-json | AG-UI event |
|---|---|
| `content_block_delta` `text_delta` | `TEXT_MESSAGE_CHUNK { role:'assistant', delta }` |
| `content_block_start` `tool_use` | `TOOL_CALL_START { toolCallId=id, toolCallName=strip(name) }` |
| `content_block_delta` `input_json_delta` | `TOOL_CALL_ARGS { toolCallId, delta=partial_json }` |
| `content_block_stop` (of a tool_use) | `TOOL_CALL_END { toolCallId }` |
| approval tool's `TOOL_CALL_END` | emit, then **stop** (kill subprocess) |

`approvalResolved` / `hasPendingApproval` continue to correlate by `toolCallId`
(AG-UI strips tool names from results) — unchanged.

## Error handling

- **Spawn fails / `claude` missing / not authed:** `run` yields a
  `TEXT_MESSAGE_CHUNK` with a readable error and a `RUN_ERROR`/finish so the
  client shows `error` status (lifecycle `onRunFailed`). No crash.
- **Malformed NDJSON line:** skip the line (defensive parse), keep streaming.
- **Process exits before any approval tool (model didn't call confirmSend):**
  turn ends naturally after the `result` line; client shows `done` with whatever
  was streamed (no pause). Acceptable; the prompt strongly steers the tool calls.
- **Stuck process:** a timeout (e.g. 60s) kills the child and emits an error.

## Testing

- **Unit (no subprocess):** `mapClaudeStream` over canned NDJSON — text-only,
  text+renderLead+confirmSend (asserts it stops at confirmSend END), mcp-prefix
  stripping, malformed-line skip, resume text mapping. Provider `run` with an
  injected fake spawn for both branches (turn 1 stops at confirmSend; resume
  yields done text).
- **Existing 28 tests stay green** (mock untouched).
- **Browser (if `claude` is authed locally):** the full click-through
  (Idle → Working → Awaiting approval → thread → Done) against the real model.
  If auth isn't available headless, document that real verification is pending a
  logged-in `claude`; ship with unit tests green.

## Out of scope (deferred)

Real Gmail/inbox data, Mastra agent loop, SDK/session-resume memory, multiple
real providers, prompt-injection hardening, audit log.
