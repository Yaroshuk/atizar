# First Real Integration — Gmail draft agent (official Google Gmail MCP)

Date: 2026-06-06
Status: design — awaiting user review

## Goal

Turn the `claude-cli` provider's **canned lead** into a **real inbox**: a small
test agent that reads the latest email in the user's Gmail, proposes a reply, and
— on one human click — saves that reply as a **draft in Gmail**. The human then
opens Gmail and sends it themselves.

This is the *first real integration*, proving the same `Provider` + HITL contract
drives a real third-party tool (Gmail) instead of trivial mock tools. The UI,
transport, and pause/resume mechanics are unchanged; only the tools become real.

**Mastra is explicitly deferred.** A real agentic loop is already provided by the
`claude` binary itself (it reads, decides, calls tools, loops). We do not need a
second loop framework to make this real — we need real tools. Mastra rejoins only
if/when we move off the Claude Code subscription onto API-key model access.

## Behavior (the test agent)

1. Agent reads the **most recent email** in the inbox (via the Gmail MCP).
2. Agent drafts a **proposed reply** to it.
3. Our UI shows: the incoming email (card) + the proposed reply (approval card)
   with a single button — **"Save draft"**.
4. Human clicks "Save draft" → we create the reply as a **draft in Gmail**.
5. Done state: **"Draft saved to Gmail."** The human goes to Gmail to review/send.

No auto-send, ever. The actual send is a live human action inside Gmail.

## Decisions (and why)

- **Variant B — draft only, never send.** The gated action is "create a Gmail
  draft," not "send." Nothing leaves the mailbox without a live click in Gmail.
  Scopes: `gmail.readonly` (read the last email) + `gmail.compose` (create the
  draft). We never call any send API. (`gmail.compose` technically also permits
  send; we self-restrict to `create_draft`.)
- **Gmail access via the official Google Gmail MCP server**, not our own Gmail
  code and not a community package. It is first-party, remote
  (`https://gmailmcp.googleapis.com/mcp/v1`), and exposes exactly what we need:
  `search_threads` / `get_thread` (read) and `create_draft` (compose), plus
  labels we don't use. Setup =  a Google Cloud project with `gmail.googleapis.com`
  + `gmailmcp.googleapis.com` enabled, an OAuth consent screen with the two scopes,
  and an OAuth 2.0 client.
- **Tool layer split — Gmail via MCP, UI/approval tools stay ours.** This keeps
  "approach A" (provider-neutral tools) intact at the MCP layer: MCP is itself a
  provider-neutral protocol, so a future API-based provider can connect to the
  same Gmail MCP server. Meanwhile our UI-driving tools (`renderLead`, the
  approval gate) stay in our own stdio MCP (`inbox-tools.mjs`) because they drive
  *our* generative UI and HITL pause, not Gmail.
  - `claude` is spawned with **both** MCP servers in `--mcp-config`: the remote
    Gmail server + our local inbox-tools server.
- **HITL is unchanged — detect-and-kill, stateless re-prime.** Turn 1: agent reads
  the email (Gmail reads are internal, filtered from the thread like ToolSearch),
  drafts a reply, calls `renderLead` (surface the email) + the approval tool
  (surface the draft). On the approval tool call we kill the subprocess (turn 1
  ends with approval unresolved). Resume (second request): a fresh `claude -p` run,
  re-primed from the message thread, calls Gmail `create_draft` and returns the
  done text. State survives the stateless model because it lives in the thread:
  the email id and the drafted body are the approval tool's call arguments.
- **Rename `confirmSend` → `saveDraft`** (passport `tools`/`approvals`/`renders`,
  the inbox-tools MCP tool, the provider `approvalNames`, the client render
  mapping). The action is now "save a draft," and the old name is misleading.
  `renderLead` keeps its name (an inbound email is the "lead" it surfaces) to
  minimize churn; it now carries real email fields.

## Architecture

```
client (unchanged)  ──POST──▶  server BFF  ──▶  CopilotRuntime
                                                     │ factory: provider.run(input)
                                                     ▼
                                          claudeCliProvider.run(input)
                                          ├─ approvalResolved? ─ no ─▶ firstTurn
                                          │   spawn `claude -p … --mcp-config {gmail, inbox-tools}`
                                          │   model: Gmail search_threads/get_thread (internal)
                                          │        → draft reply
                                          │        → renderLead(email)  + saveDraft(threadId, body)
                                          │   stdout NDJSON ─▶ mapClaudeStream ─▶ AG-UI events
                                          │   on saveDraft TOOL_CALL_END ─▶ kill, stop
                                          └─ approvalResolved? ─ yes ─▶ resumeTurn
                                              re-prime from thread (threadId + approved body)
                                              spawn `claude -p` → Gmail create_draft
                                              → "Draft saved to Gmail."
        (remote)  Google Gmail MCP: search_threads, get_thread, create_draft
        (local)   inbox-tools MCP:  renderLead, saveDraft   (UI/HITL only)
```

## Components / changes (small, single-purpose)

- **`core/inbox.agent.ts`** — passport: `tools: ['renderLead','saveDraft']`,
  `approvals: ['saveDraft']`, `renders: { renderLead: 'LeadCard', saveDraft:
  'ApprovalDialog' }`. `instructions` reworded for the read-last-email →
  draft-reply → save-draft flow.
- **`mcp/inbox-tools.mjs`** — rename `confirmSend` → `saveDraft`; its input schema
  carries what a Gmail draft needs (`threadId`/`messageId`, reply `body`, and the
  email summary for the card). Handlers stay trivial acks (UI is driven by AG-UI
  events; the real draft is created by the Gmail MCP `create_draft` on resume).
- **`core/claude-cli-provider.ts`** — `firstPrompt` instructs: read the most recent
  email via the Gmail tools, draft a reply, then call `renderLead` + `saveDraft`;
  do not send. `resumePrompt` re-primes from the thread: "human approved — create a
  Gmail draft replying to thread `<id>` with this body `<…>` via `create_draft`,
  then confirm." Approval-name param flips to `saveDraft`.
- **`server/claude-spawn.ts`** — temp `--mcp-config` now lists **two** servers
  (remote `gmail` + local `inbox`); permission `allow` list adds the Gmail MCP
  tools (`mcp__gmail__search_threads`, `mcp__gmail__get_thread`,
  `mcp__gmail__create_draft`) alongside `mcp__inbox__renderLead` /
  `mcp__inbox__saveDraft`. `--strict-mcp-config` retained.
- **Client** — `ApprovalDialog` button label → "Save draft"; done copy →
  "Draft saved to Gmail." Render registry key `confirmSend` → `saveDraft`. No
  structural UI change.
- **Google Cloud (one-time, by the user, later)** — project + enable both APIs +
  OAuth consent (scopes `gmail.readonly`, `gmail.compose`) + OAuth client.

## Risk to verify in the plan (do not assume)

The Gmail MCP server is **remote + OAuth**, but our executor is a **headless
`claude -p`** subprocess spawned with `--strict-mcp-config` and a temp config.
Need to verify how the headless run obtains/refreshes the remote server's OAuth
token: most likely "authenticate once interactively (browser), token cached, the
headless run reuses it," but the interaction with our temp `--mcp-config` +
`--strict-mcp-config` is unproven. The exact OAuth redirect URI for the client
also depends on this wiring. **This is the first thing the implementation plan
must spike**, before the agent-behavior work — if headless remote-OAuth doesn't
work cleanly, we revisit (e.g. a thin local proxy MCP, or a different auth path).

## Out of scope

- Sending email (variant B is draft-only).
- Multiple emails / inbox sweep (latest message only).
- Labels, archiving, marking read (the Gmail MCP exposes them; we don't use them).
- Mastra / API-key providers (deferred).
- Provider-neutral `core/` tool *function* registry — for Gmail we adopt the MCP
  layer as the neutral seam instead; our own UI tools remain in `inbox-tools.mjs`.

## Open thread for the plan

1. Spike headless remote-OAuth for the Gmail MCP (the risk above) — gate everything
   else on it.
2. Confirm the Gmail MCP tool names/arg shapes against the live server before
   wiring prompts (`search_threads` vs `get_thread` for "latest message"; the
   `create_draft` reply/threading fields).
3. Pin the OAuth client type + redirect URI once the wiring is known.

---

## Update 2026-06-07 — spike result + pivot to A2 (own thin Gmail MCP)

**Spike verdict (the gate): the architecture works.** A headless `claude -p` run
reached a remote Gmail MCP and reused a stored OAuth token — tools loaded and were
*called* headless. So "headless + remote MCP + token reuse" is proven. What blocked
us was **not** architecture but two real-world facts about the chosen server:

1. **The official Google Gmail MCP (`gmailmcp.googleapis.com`) is a Google
   Workspace _Developer Preview_ feature.** With everything correct on a personal
   account — project `landing-a3649`, both APIs enabled, scopes `gmail.readonly`+
   `gmail.compose` granted (verified on the account's Connections page), user added
   as a test user — every tool call still returned `PERMISSION_DENIED ("the caller
   does not have permission")`. It is gated to Workspace/preview; a personal
   `@gmail.com` cannot use it.
2. **The proven community server `@gongrzhe/server-gmail-autoauth-mcp` is archived
   (unmaintained) and is blocked by the Claude Code safety classifier** as untrusted
   external code. Its OAuth flow does work (it produced a valid token at
   `~/.gmail-mcp/credentials.json`, scope `gmail.modify gmail.settings.basic`), but
   running the package is the wrong long-term dependency anyway.

**Decision — A2: our own thin stdio Gmail MCP.** Reuse the OAuth client + token
already obtained (`~/.gmail-mcp/gcp-oauth.keys.json` + `credentials.json`). It is our
own repo code (no supply-chain risk, not classifier-blocked), durable, exactly our
two operations, and fits plan A. This supersedes the "official Google Gmail MCP"
decision above; the detour is recorded so it isn't repeated.

### The thin Gmail MCP — `apps/inbox/mcp/gmail-tools.mjs`

A sibling of `inbox-tools.mjs` (separate Node stdio process; **NOT** imported by
`core/`, so `core/` stays Node-free).

- **Dependency:** `googleapis` (server-side only).
- **Auth:** an OAuth2 client from `gcp-oauth.keys.json` (client id/secret) + the
  stored `credentials.json` (access/refresh token); paths default to `~/.gmail-mcp/`,
  overridable via env (`GMAIL_OAUTH_KEYS`, `GMAIL_OAUTH_CREDENTIALS`). Auto-refresh
  via the refresh token.
- **Tools:**
  - `get_latest_email` → `{ threadId, from, subject, body }` of the most recent
    inbox message.
  - `create_draft { threadId, body }` → fetches the thread's latest message to derive
    `To` (original sender) and `Subject` (`Re: …`), builds a reply MIME, creates a
    Gmail **draft** in that thread. Never sends.
- **Tested:** pure helpers (reply-MIME builder; Gmail-message → `{from,subject,body}`
  parser) are unit-tested; the `googleapis` calls are thin and verified live.

### Adjustments to earlier sections

- **Prompts:** `firstPrompt` instructs `get_latest_email` → `renderLead
  {from,subject,summary}` → draft → `saveDraft {threadId,body}`; `resumePrompt`
  instructs `create_draft {threadId,body}`. (Replaces the earlier generic
  `search_threads`/`get_thread` wording from the official-server plan.)
- **Spawn (Phase C):** `--mcp-config` lists `gmail` (stdio `node mcp/gmail-tools.mjs`)
  + `inbox`; permission allow-list adds `mcp__gmail__get_latest_email` and
  `mcp__gmail__create_draft`. The headless-remote-OAuth risk is **moot** under A2 —
  the token is file-based and read by our own stdio server.
- **Scope note:** the obtained token is `gmail.modify` (broader than the
  `readonly`+`compose` we'd ideally use) because that's what the now-abandoned
  GongRzhe auth requested. `modify` covers read + draft; tightening to
  `readonly`+`compose` is a later cleanup (re-consent with our own scope set).
