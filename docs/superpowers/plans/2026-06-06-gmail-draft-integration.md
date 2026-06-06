# Gmail Draft Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The `claude-cli` inbox agent reads the latest real email, proposes a reply, and on one human click saves it as a **draft in Gmail** (never sends).

**Architecture:** Keep the existing `Provider` + detect-and-kill HITL + stateless re-prime. Gmail access comes from the **official Google Gmail MCP server** (remote, OAuth) wired into the `claude -p` spawn alongside our own `inbox-tools` stdio MCP (which keeps the UI/approval tools). The canned `LEAD` is removed; the agent reads via Gmail tools and the draft is created on resume via Gmail `create_draft`. State survives the stateless model because the Gmail thread id and the drafted body are the `saveDraft` tool-call arguments in the message thread.

**Tech Stack:** TypeScript, vitest, `@ag-ui/client`, `@modelcontextprotocol/sdk`, the `claude` CLI binary, CopilotKit v2, the Google Gmail MCP (`https://gmailmcp.googleapis.com/mcp/v1`).

**Spec:** `docs/superpowers/specs/2026-06-06-gmail-draft-integration-design.md`

**Run all commands from `apps/inbox/`.**

---

## Dependency map (read before starting)

- **Phase A (Tasks 1–5)** is pure code, **independent of Gmail access** — rename, schema, prompts, client. Full TDD. Do this now even if Google Cloud isn't set up.
- **Prerequisite P (manual, the user)** — Google Cloud setup. Blocks Phase B only.
- **Phase B (Task 6, the SPIKE)** — prove headless `claude -p` + remote Gmail MCP + OAuth works **at all**. Gate: if it fails, STOP and revisit the spec (e.g. a local proxy MCP) before Task 7.
- **Phase C (Tasks 7–8)** — wire the Gmail MCP into the spawn and verify end-to-end. Depends on P + Task 6 + Phase A.

---

## Prerequisite P (manual — the user, before Phase B)

Not a code task. The user performs this once in Google Cloud:

1. Create / pick a project; note `PROJECT_ID`.
2. `gcloud services enable gmail.googleapis.com --project=PROJECT_ID`
3. `gcloud services enable gmailmcp.googleapis.com --project=PROJECT_ID`
4. OAuth consent screen: app name `Gmail MCP Server`; user type Internal (if the project is under the `magmamath.com` Workspace org) or External + add self as Test user; add scopes `https://www.googleapis.com/auth/gmail.readonly` and `https://www.googleapis.com/auth/gmail.compose`.
5. Create an OAuth 2.0 client (type pinned in Task 6 once the headless auth path is known); record `client_id` + `client_secret`.

---

## Phase A — Gmail-independent code (TDD, do now)

### Task 1: Rename `confirmSend` → `saveDraft` (passport + name-agnostic refactor)

Pure rename: the approval-detection logic is already parameterized by name, so behavior is unchanged and the suite must stay green. New args schema is handled in Task 2 — this task only renames.

**Files:**
- Modify: `core/inbox.agent.ts`
- Modify: `core/inbox.agent.test.ts`
- Modify: `core/defineAgent.test.ts`
- Modify: `core/mock-provider.ts`
- Modify: `core/mock-provider.test.ts`
- Modify: `core/claude-stream.ts` (comment only)
- Modify: `core/claude-cli-provider.test.ts`
- Modify: `client/src/useAgentStatus.test.ts`

- [ ] **Step 1: Update the passport.** In `core/inbox.agent.ts`, replace the three `confirmSend` occurrences:

```ts
  tools: ['renderLead', 'saveDraft'],
  approvals: ['saveDraft'],
  renders: { renderLead: 'LeadCard', saveDraft: 'ApprovalDialog' },
```

- [ ] **Step 2: Update passport + defineAgent tests.** In `core/inbox.agent.test.ts` change `expect(inboxAgent.approvals).toEqual(['confirmSend'])` → `['saveDraft']`. In `core/defineAgent.test.ts` change the fixture lines 9–11 and the assertion line 18 from `confirmSend` → `saveDraft` (keep `renderLead`).

- [ ] **Step 3: Update the mock provider + its test.** In `core/mock-provider.ts` line 47, rename the tool and update args to the new shape:

```ts
      yield* toolCall('saveDraft', { threadId: 'thread_demo', body: 'Thanks for reaching out — here is a reply.' })
```

  Update the line-33 comment `confirmSend` → `saveDraft`. In `core/mock-provider.test.ts` lines 17/26/35: `createMockInboxProvider(['saveDraft'])`, expected `toolNames` `['renderLead', 'saveDraft']`, and the fixture tool name `'saveDraft'`. Update the line-19 `it(...)` title.

- [ ] **Step 4: Update remaining name-agnostic fixtures.** In `core/claude-cli-provider.test.ts` replace every `'confirmSend'` and `mcp__inbox__confirmSend` with `'saveDraft'` / `mcp__inbox__saveDraft` (lines ~34, 43, 49, 52, 59, 61, 72). In `client/src/useAgentStatus.test.ts` rename the `confirmSendCall` helper → `saveDraftCall`, the `function: { name: 'confirmSend' }` → `'saveDraft'`, and the `hasPendingApproval(messages, ['confirmSend'])` calls → `['saveDraft']` (lines ~25–76). In `core/claude-stream.ts` line 4 comment, change `confirmSend` → `saveDraft`. Leave `core/messages.test.ts` and `core/claude-stream.test.ts` as-is — their `'confirmSend'` strings are generic approval-name examples for the name-agnostic layer (renaming them is cosmetic; out of scope).

- [ ] **Step 5: Run the full suite.**

Run: `npm test`
Expected: PASS (same count as before — this is a rename, no behavior change).

- [ ] **Step 6: Commit.**

```bash
git add core/inbox.agent.ts core/inbox.agent.test.ts core/defineAgent.test.ts core/mock-provider.ts core/mock-provider.test.ts core/claude-stream.ts core/claude-cli-provider.test.ts client/src/useAgentStatus.test.ts
git commit -m "refactor: rename confirmSend -> saveDraft (action is now save-draft, not send)"
```

### Task 2: New tool arg schemas (`renderLead` email + `saveDraft` draft)

`renderLead` surfaces the incoming email (`from`, `subject`, `summary`); `saveDraft` carries what a Gmail draft needs and what resume re-reads from the thread (`threadId`, `body`). The numeric `id`/`leadId`/`message` shape is replaced.

**Files:**
- Modify: `mcp/inbox-tools.mjs`
- Modify: `client/src/actions.tsx`
- Modify: `client/src/components/LeadCard.tsx`
- Modify: `client/src/components/ApprovalDialog.tsx`
- Modify: `client/src/renderLead.test.tsx`

- [ ] **Step 1: Update the failing render test first.** In `client/src/renderLead.test.tsx`, change the streamed `renderLead` tool-call fixture (around lines 22–) and assertions to the new shape — `from`, `subject`, `summary` (no numeric `id`):

```tsx
          name: 'renderLead',
          arguments: JSON.stringify({
            from: 'ivan@acme.ru',
            subject: 'Order: 10 units',
            summary: 'Customer wants to order 10 units; asks about delivery time.',
          }),
```

  And assert the card shows the summary, e.g. `expect(screen.getByText(/order 10 units/i)).toBeInTheDocument()` (adjust to the fixture text). Keep the existing `from`/`subject` assertions.

- [ ] **Step 2: Run the render test to verify it fails.**

Run: `npm test -- renderLead`
Expected: FAIL (component/types still expect numeric `id`/`intent`).

- [ ] **Step 3: Update LeadCard to the email shape.** In `client/src/components/LeadCard.tsx`:

```tsx
type Lead = { from: string; subject: string; summary: string }

type LeadCardProps = { lead: Lead }

export const LeadCard = ({ lead }: LeadCardProps) => {
  return (
    <div style={{ border: '1px solid #ddd', borderRadius: 10, padding: 12, background: '#fff', margin: '8px 0' }}>
      <div style={{ fontSize: 12, color: '#888' }}>✉️ {lead.from}</div>
      <div style={{ fontWeight: 600 }}>{lead.subject}</div>
      <div style={{ fontSize: 13, color: '#444', marginTop: 4 }}>{lead.summary}</div>
    </div>
  )
}
```

- [ ] **Step 4: Update `actions.tsx` schemas + render bodies.** Replace the `renderLead` parameters/render and the `saveDraft` (formerly `confirmSend`) block:

```tsx
  // renderLead -> <LeadCard /> (pure generative UI).
  useRenderTool(
    {
      name: 'renderLead',
      parameters: z.object({ from: z.string(), subject: z.string(), summary: z.string() }),
      render: ({ parameters }) => {
        const { from, subject, summary } = parameters
        if (from === undefined || subject === undefined || summary === undefined) return <></>
        const Lead = renderRegistry[inboxAgent.renders.renderLead]
        return <Lead lead={{ from, subject, summary }} />
      },
    },
    []
  )

  // saveDraft -> <ApprovalDialog /> (human-in-the-loop pause).
  useHumanInTheLoop<{ threadId: string; body: string }>(
    {
      name: 'saveDraft',
      parameters: z.object({ threadId: z.string(), body: z.string() }),
      render: ({ args, status, respond }) => {
        if (args.threadId === undefined || args.body === undefined) return <></>
        const data = { threadId: args.threadId, body: args.body }
        const Approval = renderRegistry[inboxAgent.renders.saveDraft]
        return (
          <Approval
            data={data}
            onApprove={() => {
              if (status === 'executing' && respond) void respond('approved')
            }}
          />
        )
      },
    },
    []
  )
```

- [ ] **Step 5: Update ApprovalDialog (data shape + button label).** In `client/src/components/ApprovalDialog.tsx`:

```tsx
type ApprovalData = { threadId: string; body: string }

type ApprovalDialogProps = { data: ApprovalData; onApprove: () => void }

export const ApprovalDialog = ({ data, onApprove }: ApprovalDialogProps) => {
  return (
    <div style={{ border: '1px solid #f0c000', borderRadius: 10, padding: 12, background: '#fffbe6', margin: '8px 0' }}>
      <div style={{ marginBottom: 8, whiteSpace: 'pre-wrap' }}>{data.body}</div>
      <button onClick={onApprove} style={{ background: '#0a7', color: '#fff', border: 0, borderRadius: 6, padding: '6px 14px' }}>
        Save draft
      </button>
    </div>
  )
}
```

- [ ] **Step 6: Update the inbox-tools MCP schemas.** In `mcp/inbox-tools.mjs`:

```js
server.registerTool(
  'renderLead',
  {
    description: 'Surface the incoming email as a card in the UI.',
    inputSchema: { from: z.string(), subject: z.string(), summary: z.string() },
  },
  async () => ({ content: [{ type: 'text', text: 'Email surfaced to the user.' }] }),
)

server.registerTool(
  'saveDraft',
  {
    description: 'Ask the human to approve saving a draft reply. Args carry the Gmail thread id and the proposed reply body.',
    inputSchema: { threadId: z.string(), body: z.string() },
  },
  async () => ({ content: [{ type: 'text', text: 'Awaiting human approval.' }] }),
)
```

  Update the top-of-file comment (`confirmSend` → `saveDraft`).

- [ ] **Step 7: Run the render test + typecheck.**

Run: `npm test -- renderLead && npm run typecheck`
Expected: PASS + clean tsc.

- [ ] **Step 8: Commit.**

```bash
git add mcp/inbox-tools.mjs client/src/actions.tsx client/src/components/LeadCard.tsx client/src/components/ApprovalDialog.tsx client/src/renderLead.test.tsx
git commit -m "feat: tool schemas for real email (renderLead) + Gmail draft (saveDraft)"
```

### Task 3: Provider — extract draft context from the thread on resume

The provider must build the resume prompt from the `saveDraft` tool-call args already in `input.messages` (the stateless-re-prime contract), instead of a hardcoded `LEAD`. Add a pure helper that pulls `{ threadId, body }` from the thread.

**Files:**
- Modify: `core/messages.ts`
- Modify: `core/messages.test.ts`
- Modify: `core/claude-cli-provider.ts`
- Modify: `core/claude-cli-provider.test.ts`

- [ ] **Step 1: Write the failing helper test.** In `core/messages.test.ts`, add (reuse the file's existing `assistantWithToolCall` helper — extend it to accept args, or add a local fixture builder):

```ts
import { lastApprovalArgs } from './messages'

describe('lastApprovalArgs', () => {
  it('returns the parsed args of the most recent matching approval tool call', () => {
    const msgs = [
      { role: 'assistant', toolCalls: [{ id: 'x1', type: 'function', function: { name: 'saveDraft', arguments: '{"threadId":"t_9","body":"Hello"}' } }] },
    ] as any
    expect(lastApprovalArgs(msgs, ['saveDraft'])).toEqual({ threadId: 't_9', body: 'Hello' })
  })

  it('returns null when no matching approval tool call exists', () => {
    const msgs = [
      { role: 'assistant', toolCalls: [{ id: 'x1', type: 'function', function: { name: 'renderLead', arguments: '{}' } }] },
    ] as any
    expect(lastApprovalArgs(msgs, ['saveDraft'])).toBeNull()
  })

  it('returns null when the args are not valid JSON', () => {
    const msgs = [
      { role: 'assistant', toolCalls: [{ id: 'x1', type: 'function', function: { name: 'saveDraft', arguments: '{bad' } }] },
    ] as any
    expect(lastApprovalArgs(msgs, ['saveDraft'])).toBeNull()
  })
})
```

- [ ] **Step 2: Run it to verify it fails.**

Run: `npm test -- messages`
Expected: FAIL with "lastApprovalArgs is not a function" (or import error).

- [ ] **Step 3: Implement the helper.** In `core/messages.ts`, add (use the file's existing `Message`/`toolCallsOf` patterns; iterate newest-last):

```ts
// The parsed arguments of the most recent assistant tool call whose name is in
// `approvalNames`, or null if none / unparseable. Used to re-prime a stateless
// resume run from the approval the human just answered.
export function lastApprovalArgs(
  messages: Message[],
  approvalNames: readonly string[],
): Record<string, unknown> | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.role !== 'assistant' || !m.toolCalls) continue
    for (const tc of m.toolCalls) {
      if (approvalNames.includes(tc.function.name)) {
        try {
          return JSON.parse(tc.function.arguments) as Record<string, unknown>
        } catch {
          return null
        }
      }
    }
  }
  return null
}
```

  (Adjust `m.role`/`m.toolCalls`/`tc.function` access to match the exact `Message`/`ToolCall` shapes already imported in `messages.ts`.)

- [ ] **Step 4: Run the helper test to verify it passes.**

Run: `npm test -- messages`
Expected: PASS.

- [ ] **Step 5: Write the failing provider resume test.** In `core/claude-cli-provider.test.ts`, add a test that on resume the spawn receives a prompt containing the thread id + body from the thread:

```ts
it('resume: re-primes from the saveDraft args in the thread', async () => {
  let seenPrompt = ''
  const spawn = (prompt: string) => {
    seenPrompt = prompt
    return { lines: linesOf([textDelta('Draft saved to Gmail.')]), kill: () => {} }
  }
  const provider = createClaudeCliProvider({ approvalNames: ['saveDraft'], surfaceTools: ['renderLead', 'saveDraft'], instructions: 'x', spawn })
  const messages = [
    { role: 'assistant', toolCalls: [{ id: 'tc_d', type: 'function', function: { name: 'saveDraft', arguments: '{"threadId":"t_42","body":"Hi Ivan"}' } }] },
    { role: 'tool', toolCallId: 'tc_d', content: 'approved' },
  ]
  for await (const _ of provider.run({ messages } as any)) { /* drain */ }
  expect(seenPrompt).toContain('t_42')
  expect(seenPrompt).toContain('Hi Ivan')
  expect(seenPrompt).toContain('create_draft')
})
```

  (Match `linesOf`/`textDelta` to the helpers already used in this test file.)

- [ ] **Step 6: Run it to verify it fails.**

Run: `npm test -- claude-cli-provider`
Expected: FAIL (resume prompt still uses the hardcoded `LEAD`, no `t_42`).

- [ ] **Step 7: Rewrite the provider prompts.** In `core/claude-cli-provider.ts`: delete the `LEAD` constant; rewrite `firstPrompt` and `resumePrompt`, and have `run` pass the extracted args:

```ts
import { approvalResolved, lastApprovalArgs, type Message } from './messages.js'

function firstPrompt(instructions: string): string {
  return [
    instructions,
    '',
    'Read the single most recent email in the inbox using the Gmail tools',
    '(search the inbox, then get that thread). Then call renderLead with',
    '{ from, subject, summary } to surface it, and draft a short reply.',
    'Then call saveDraft with { threadId, body } — threadId is the Gmail thread',
    'id of that email, body is your drafted reply — to ask the human before saving.',
    'Do NOT create the draft yet and do NOT send anything. Do not narrate your',
    'tool usage or mention tools/schemas — keep any text brief and user-facing.',
  ].join('\n')
}

function resumePrompt(instructions: string, threadId: string, body: string): string {
  return [
    instructions,
    '',
    `The human APPROVED saving this reply. Create it as a Gmail DRAFT now by`,
    `calling create_draft, replying within thread "${threadId}", with this body:`,
    '',
    body,
    '',
    'Do not send. After the draft is created, reply with one short sentence',
    'confirming the draft was saved to Gmail. Do not narrate tool usage.',
  ].join('\n')
}
```

  In `run`, on the resume branch:

```ts
      const resuming = approvalResolved(messages, approvalNames)
      let prompt: string
      if (resuming) {
        const args = lastApprovalArgs(messages, approvalNames)
        const threadId = typeof args?.threadId === 'string' ? args.threadId : ''
        const body = typeof args?.body === 'string' ? args.body : ''
        prompt = resumePrompt(instructions, threadId, body)
      } else {
        prompt = firstPrompt(instructions)
      }
      try {
        child = spawn(prompt)
      } catch (err) { /* unchanged */ }
```

- [ ] **Step 8: Run the provider + full suite.**

Run: `npm test -- claude-cli-provider && npm test`
Expected: PASS.

- [ ] **Step 9: Commit.**

```bash
git add core/messages.ts core/messages.test.ts core/claude-cli-provider.ts core/claude-cli-provider.test.ts
git commit -m "feat(provider): drop canned lead; read via Gmail, re-prime resume from saveDraft args"
```

### Task 4: Update passport instructions for the Gmail flow

**Files:**
- Modify: `core/inbox.agent.ts`

- [ ] **Step 1: Reword instructions.**

```ts
  instructions:
    'Read the latest email in the inbox, draft a reply, and ask the human before saving it as a draft.',
```

- [ ] **Step 2: Run the suite + typecheck + lint.**

Run: `npm test && npm run typecheck && npm run lint`
Expected: PASS, clean.

- [ ] **Step 3: Commit.**

```bash
git add core/inbox.agent.ts
git commit -m "docs(passport): instructions for the read-email -> draft-reply -> save-draft flow"
```

### Task 5: Mock provider end-to-end sanity (no Gmail needed)

Confirm the whole UI loop still works on the `mock` provider with the new schemas — this de-risks Phase A independently of Google Cloud.

**Files:** none (manual run).

- [ ] **Step 1: Point the passport at the mock temporarily.** In `core/inbox.agent.ts` set `provider: 'mock'` (revert before committing later).
- [ ] **Step 2: Run the app.**

Run: `npm run dev`
Then open `http://localhost:5173`.

- [ ] **Step 3: Verify the loop.** Click START → card goes Working → an email card (LeadCard with from/subject/summary) + an approval card showing the draft body and a **"Save draft"** button → status "Awaiting approval" → click "Save draft" → resume → "done" text. No console errors.
- [ ] **Step 4: Revert the provider.** Set `provider: 'claude-cli'` back in `core/inbox.agent.ts`.
- [ ] **Step 5: Commit (only if anything changed).**

```bash
git add -A && git commit -m "chore: verify mock loop on new schemas; restore claude-cli provider"
```

---

## Phase B — The spike (GATE; needs Prerequisite P)

### Task 6: Spike — headless `claude -p` + remote Gmail MCP + OAuth

**This is exploratory, not TDD.** Goal: prove a headless `claude -p` run can call the remote Gmail MCP (read an email + create a draft) using OAuth. **If it cannot be made to work cleanly, STOP — do not start Task 7. Return to the spec and choose a fallback (e.g. a thin local proxy MCP that holds the Gmail token).**

**Files:** none yet (throwaway probing; findings get written down).

- [ ] **Step 1: Authenticate the Gmail MCP interactively once.** Add the remote server to the local `claude` config and complete the browser OAuth (using the `client_id`/`client_secret` from Prerequisite P):

Run: `claude mcp add --transport http gmail https://gmailmcp.googleapis.com/mcp/v1`
Then in an interactive `claude` session run `/mcp` and complete the Gmail OAuth in the browser. Confirm the connector shows connected.

- [ ] **Step 2: Probe a non-strict headless read.** Verify a headless print run can reach the Gmail tools using the stored token:

Run: `claude -p "List the Gmail MCP tools available to you, then read the subject of my most recent email." --output-format stream-json --verbose`
Expected: the stream shows a `mcp__gmail__*` tool call and returns a real subject line. Record whether the stored OAuth token was picked up without re-auth.

- [ ] **Step 3: Probe with our spawn flags.** Re-run with the flags our provider uses, pointing a temp `--mcp-config` at BOTH servers, to find out whether `--strict-mcp-config` blocks the stored remote token:

```bash
cat > /tmp/spike-mcp.json <<'JSON'
{ "mcpServers": {
  "gmail": { "type": "http", "url": "https://gmailmcp.googleapis.com/mcp/v1" },
  "inbox": { "type": "stdio", "command": "node", "args": ["FULL/PATH/TO/apps/inbox/mcp/inbox-tools.mjs"] }
} }
JSON
claude -p "Read the subject of my most recent email via the Gmail tools." \
  --mcp-config /tmp/spike-mcp.json --strict-mcp-config \
  --output-format stream-json --verbose
```

Expected (success): a `mcp__gmail__*` call + a real subject, no auth prompt. **If it instead errors with an auth/connection failure, the OAuth token isn't reachable under `--strict-mcp-config` + temp config — record this and STOP (gate failed).**

- [ ] **Step 4: Probe a draft creation.** If Step 3 succeeded:

Run: `claude -p "Create a Gmail draft replying to my most recent email saying 'Thanks, will follow up.' Use create_draft. Do not send." --mcp-config /tmp/spike-mcp.json --strict-mcp-config --output-format stream-json --verbose`
Expected: a `mcp__gmail__create_draft` call; a new draft appears in Gmail; nothing is sent.

- [ ] **Step 5: Write down the verdict.** Append a short "Spike result" note to the spec file (`docs/superpowers/specs/2026-06-06-gmail-draft-integration-design.md`): does headless remote-OAuth work as-is? What exact OAuth client type / redirect URI worked? Any flags needed? Commit:

```bash
git add docs/superpowers/specs/2026-06-06-gmail-draft-integration-design.md
git commit -m "docs(spec): Gmail MCP headless-OAuth spike result"
```

**GATE:** proceed to Task 7 only if Steps 3–4 succeeded.

---

## Phase C — Wire Gmail into the spawn + end-to-end (needs Task 6 green)

### Task 7: Add the Gmail MCP to the real spawn config

**Files:**
- Modify: `server/claude-spawn.ts`

- [ ] **Step 1: Add the remote Gmail server + tool allow-list.** In `server/claude-spawn.ts`, extend the temp `mcp-config` and the permission `allow` list:

```ts
  writeFileSync(
    mcpConfig,
    JSON.stringify({
      mcpServers: {
        inbox: { type: 'stdio', command: 'node', args: [MCP_SERVER] },
        gmail: { type: 'http', url: 'https://gmailmcp.googleapis.com/mcp/v1' },
      },
    }),
  )
  writeFileSync(
    settings,
    JSON.stringify({
      permissions: {
        allow: [
          'mcp__inbox__renderLead',
          'mcp__inbox__saveDraft',
          'mcp__gmail__search_threads',
          'mcp__gmail__get_thread',
          'mcp__gmail__create_draft',
        ],
        deny: BUILTINS,
      },
    }),
  )
```

  (Use the exact Gmail tool names/transport confirmed in Task 6 — adjust `search_threads`/`get_thread` if the spike showed different names. Keep `--strict-mcp-config` only if the spike proved it works with the stored token; otherwise apply the spike's documented workaround.)

- [ ] **Step 2: Typecheck + lint.**

Run: `npm run typecheck && npm run lint`
Expected: clean.

- [ ] **Step 3: Commit.**

```bash
git add server/claude-spawn.ts
git commit -m "feat(server): wire the official Gmail MCP into the claude spawn"
```

### Task 8: End-to-end manual verification (real Gmail)

**Files:** none (manual run).

- [ ] **Step 1: Ensure a real recent email exists** in the authenticated Gmail account (send yourself one if needed).
- [ ] **Step 2: Run the app.**

Run: `npm run dev`
Then open `http://localhost:5173`.

- [ ] **Step 3: Verify the real loop.** Click START → the real most-recent email appears in the LeadCard (real from/subject/summary) → an approval card shows the agent's drafted reply + "Save draft" → status "Awaiting approval" → click "Save draft" → resume → "Draft saved to Gmail."
- [ ] **Step 4: Confirm in Gmail.** Open Gmail → Drafts → the reply draft is there, threaded to the original email, **not sent**.
- [ ] **Step 5: Update the docs.** In `CLAUDE.md`, replace the Gmail "TODO/next" framing with a "Gmail draft integration — BUILT" note (files touched + the spike outcome). Commit:

```bash
git add CLAUDE.md
git commit -m "docs: Gmail draft integration built and browser-verified end-to-end"
```

---

## Self-review notes (coverage)

- Spec "Behavior" (read latest → draft → Save draft → Gmail draft): Tasks 3 (prompts), 2 (UI), 7–8 (wiring + e2e). ✅
- Spec "draft only, never send": enforced in prompts (Task 3) + allow-list excludes any send tool (Task 7). ✅
- Spec "official Gmail MCP, two servers in spawn": Tasks 6–7. ✅
- Spec "tool split — Gmail via MCP, UI tools ours": `inbox-tools.mjs` keeps renderLead/saveDraft (Task 2); Gmail tools from the remote server (Task 7). ✅
- Spec "HITL unchanged, state in thread": `lastApprovalArgs` + resume re-prime (Task 3). ✅
- Spec "rename confirmSend → saveDraft": Task 1. ✅
- Spec "headless remote-OAuth is the first gate": Task 6, STOP-on-fail. ✅
- Spec Prerequisite (Google Cloud): Prerequisite P (manual). ✅

---

## REVISED Phase B/C — A2: own thin Gmail MCP (2026-06-07)

**Supersedes the original Tasks 6–8.** The spike proved the architecture (headless
`claude -p` + remote MCP + token reuse works), but the official `gmailmcp.googleapis.com`
is Workspace-preview-gated (403 on personal accounts) and the community GongRzhe
package is archived + classifier-blocked. Pivot: a thin stdio Gmail MCP we own,
reusing the OAuth client + token already at `~/.gmail-mcp/` (`gcp-oauth.keys.json` +
`credentials.json`, scope `gmail.modify`). Phase A (Tasks 1–5) stands unchanged. See
the spec's "Update 2026-06-07" section.

Status of the original tasks: **Task 6 (spike) — DONE** (verdict above, recorded in
the spec). Original Tasks 7–8 are replaced by Tasks 6a–6d below.

### Task 6a: Pure helpers for the Gmail MCP (TDD)

**Files:**
- Create: `apps/inbox/mcp/gmail-format.mjs` (pure, no googleapis/network)
- Create: `apps/inbox/mcp/gmail-format.test.mjs` (or `.test.ts` if vitest picks `.mjs` up — match repo test config)

Two pure functions:
- `parseLatestMessage(gmailMessage)` → `{ threadId, from, subject, body }` — given a
  Gmail `users.messages.get` payload (format `full`), extract `threadId`, the `From`
  header, the `Subject` header, and the decoded text body (walk `payload.parts` for
  `text/plain`, base64url-decode; fall back to `payload.body`/`snippet`).
- `buildReplyRaw({ to, subject, body, threadId })` → a base64url-encoded RFC822
  string for a reply: `To:`, `Subject:` prefixed `Re: ` (don't double-prefix if it
  already starts with `Re:`), a plain-text body. (Headers `In-Reply-To`/`References`
  optional — skip for the thin version; threading is carried by the draft's
  `threadId` at create time.)

- [ ] **Step 1: Write failing tests** for both functions (decode a small fixture
  Gmail message → assert extracted fields; build a reply → assert `To`/`Subject: Re: `
  present and body round-trips after base64url-decode; assert no double `Re: Re:`).
- [ ] **Step 2: Run, verify they fail.** `npm test -- gmail-format`
- [ ] **Step 3: Implement** the two pure functions.
- [ ] **Step 4: Run, verify pass.** `npm test -- gmail-format`
- [ ] **Step 5: Commit.** `git add apps/inbox/mcp/gmail-format.* && git commit -m "feat(gmail): pure helpers — parse latest message + build reply MIME"`

### Task 6b: The thin Gmail stdio MCP server

**Files:**
- Modify: `apps/inbox/package.json` (add `googleapis` dependency)
- Create: `apps/inbox/mcp/gmail-tools.mjs`

- [ ] **Step 1: Add the dep.** `cd apps/inbox && npm install googleapis`
- [ ] **Step 2: Write `mcp/gmail-tools.mjs`** — a stdio MCP server (mirror
  `mcp/inbox-tools.mjs` structure: `McpServer` + `StdioServerTransport`). Build an
  `google.auth.OAuth2` from `gcp-oauth.keys.json` (`installed`/`web` client id+secret)
  and set credentials from `credentials.json` (access + refresh token); paths default
  to `~/.gmail-mcp/gcp-oauth.keys.json` and `~/.gmail-mcp/credentials.json`,
  overridable via env `GMAIL_OAUTH_KEYS` / `GMAIL_OAUTH_CREDENTIALS`. Register two
  tools, using the Task 6a helpers:
  - `get_latest_email` (no args) → `users.messages.list({userId:'me', q:'in:inbox', maxResults:1})`
    → `users.messages.get({id, format:'full'})` → `parseLatestMessage` → return JSON
    `{ threadId, from, subject, body }` as the tool text.
  - `create_draft` (`{ threadId: string, body: string }`) → `users.messages.get` the
    latest message in `threadId` to derive `to` (its `From`) + `subject` →
    `buildReplyRaw` → `users.drafts.create({ userId:'me', requestBody:{ message:{ raw, threadId } } })`
    → return a short confirmation (e.g. the draft id). **Never** call `messages.send`.
  Surface tool errors as a JSON `{ error: message }` tool result (so the model can
  report them), not an uncaught throw.
- [ ] **Step 3: Typecheck/lint** (the `.mjs` is plain Node; ensure `npm run lint` is
  clean or the file is covered by the right lint config). `npm run typecheck && npm run lint`
- [ ] **Step 4: Commit.** `git add apps/inbox/package.json apps/inbox/package-lock.json apps/inbox/mcp/gmail-tools.mjs && git commit -m "feat(gmail): thin stdio Gmail MCP — get_latest_email + create_draft"`

### Task 6c: Align provider prompts to the real tool names

**Files:**
- Modify: `apps/inbox/core/claude-cli-provider.ts`
- Modify: `apps/inbox/core/claude-cli-provider.test.ts`

- [ ] **Step 1:** In `firstPrompt`, replace the generic "search the inbox, then get
  that thread" wording with: call `get_latest_email` to read the most recent email,
  then `renderLead {from, subject, summary}`, draft a reply, then `saveDraft
  {threadId, body}`. In `resumePrompt`, keep the `create_draft` instruction (already
  there) — ensure it names `create_draft` with `{threadId, body}`.
- [ ] **Step 2:** Update any provider test asserting prompt text (the resume test
  asserts `create_draft` — keep; add/adjust a firstPrompt assertion for
  `get_latest_email` if useful). Run `npm test -- claude-cli-provider`.
- [ ] **Step 3: Commit.** `git add apps/inbox/core/claude-cli-provider.* && git commit -m "feat(provider): prompts call get_latest_email / create_draft (own Gmail MCP)"`

### Task 6d: Wire the Gmail MCP into the spawn

**Files:**
- Modify: `apps/inbox/server/claude-spawn.ts`

- [ ] **Step 1:** Add the gmail stdio server to the temp `--mcp-config` alongside
  `inbox`: `gmail: { type: 'stdio', command: 'node', args: [GMAIL_SERVER] }` where
  `GMAIL_SERVER = fileURLToPath(new URL('../mcp/gmail-tools.mjs', import.meta.url))`.
  Add to the permission `allow` list: `mcp__gmail__get_latest_email`,
  `mcp__gmail__create_draft`. Keep `--strict-mcp-config`.
- [ ] **Step 2: Typecheck/lint.** `npm run typecheck && npm run lint`
- [ ] **Step 3: Commit.** `git add apps/inbox/server/claude-spawn.ts && git commit -m "feat(server): wire the thin Gmail MCP into the claude spawn"`

### Task 6e: Live spike + end-to-end (controller-run, not a subagent)

- [ ] **Live read+draft probe** (headless, our own MCP — not classifier-blocked):
  `claude -p` with a temp `--mcp-config` containing `node mcp/gmail-tools.mjs`,
  `--allowedTools "mcp__gmail"` — confirm `get_latest_email` returns a real
  subject/sender and `create_draft` lands a draft in Gmail (check Drafts).
- [ ] **Browser e2e on the real provider:** `npm run dev`, START → real latest email
  in LeadCard → drafted reply + "Save draft" → approve → "Draft saved to Gmail." →
  confirm the draft exists in Gmail, not sent.
- [ ] **Docs:** flip CLAUDE.md's Gmail "next" framing to "BUILT (A2, own thin Gmail
  MCP)" with the spike verdict + the official/community detour gotcha. Commit.
