# Agent view & lifecycle — E2E case catalog

**Purpose:** a hand-off list of EVERY user-visible case in the agent view / run-instance lifecycle,
so an agent can build E2E coverage. Each case is a Given/When/Then scenario. This is the **acceptance
surface**: once these are green, the design in
`2026-06-17-agent-view-lifecycle-presentation.md` (+ `2026-06-17-live-ui-single-source.md`) is met.

**How to use this doc.** Turn each case into one E2E test (browser via the `browser-verify` skill;
deterministic runs via `DEV_RECORD_REPLAY` cassettes — see `docs/dev-record-replay.md`). Some cases
describe **current** behavior (should pass now), some describe **target** behavior (will fail until
the fix lands — write them, mark pending). Tag legend:

- ✅ **current** — expected to pass against today's code.
- 🎯 **target** — desired end-state; will FAIL until the fix is implemented (write as the acceptance
  test; keep red/skip until done).
- 🔮 **future** — not built yet (inter-agent join, explicit input-field); scaffold only, do not block.

**Vocabulary:** Agent (type) ⊃ Instance (correlation, no stored status) ⊃ Run (= WorkItem,
`(phase,outcome)`) ⊃ Gate. Liveness unit = the **instance** (live iff ≥1 live run). A run is never
individually hidden.

**Test infra notes:** to force REAL runs (distinct tool-call ids, needed for concurrent HITL) use
`DEV_RECORD_REPLAY=record`; replay (`=1`) reuses recorded ids and can show a false "second button
dead" for concurrent HITL. Dev mode (`localStorage['aiw.dev']='1'`) reveals raw tool chips — keep it
OFF for consumer-surface assertions.

---

## 1. Pipeline (live tree)

- **P1** ✅ Running instance shows in the pipeline.
- **P2** ✅ Awaiting-approval instance shows in the pipeline.
- **P3** ✅/🎯 Errored instance shows in the pipeline (red). *(stays per Option A.)*
- **P4** 🎯 A `done` instance **leaves** the pipeline once it has no live run.
- **P5** 🎯 A `stopped` instance **leaves** the pipeline.
- **P6** ✅ A `done` PARENT with a live child **stays** in the pipeline, labelled "Working"
  (`hasLiveDescendant`). When the child finishes too, the parent leaves.
- **P7** 🎯 **Completion animation:** when an instance goes live→terminal, its node does NOT vanish in
  the same frame — it lingers briefly then fades out. (Assert the node is present for the linger
  window, then gone.)
- **P8** ✅ Pipeline grouping: 1 instance of an agent → one row; ≥2 → agent mini-header (`N active`) +
  nested rows + `queued: N`.

## 2. Agent card (type surface)

- **C1** ✅ Every agent has a card showing its description (what it does), regardless of instance
  state.
- **C2** 🎯 Card live overlay count uses **isBusy** (running + awaiting) — `done`/`stopped`/`rejected`
  do NOT raise the count; `error` does not raise it either (free slot).
- **C3** 🎯 Card status pill reflects only the agent's **own live** instances. A worker whose only
  instances are terminal shows **idle/ready**, NOT "Stopped"/"Done"/"Rejected".
- **C4** ✅ START shows only for **input** agents; worker card footer = "Runs from a handoff".
- **C5** ✅ START is gated by credential health (no creds → START disabled/explained).
- **C6** 🎯 Card color rollup = worst **live** child (error red > awaiting amber > running blue >
  none/neutral).

## 3. Input vs worker agents

- **IW1** ✅ Input agent (sorter) card stays present after its scan is `done` and offers START
  (re-scan).
- **IW2** ✅ Input agent card shows the **last scan result** (INBOX SORTED) as its content.
- **IW3** 🎯 Worker agent with only terminal instances shows the descriptive type-view, not a stale
  status.
- **IW4** ✅ Worker agent never shows START.

## 4. Instance open-routing (card → instances)

- **R1** 🎯 Open an agent with **0 live** instances → descriptive type-view (intro + START/handoff).
- **R2** 🎯 Open an agent with **1 live** instance → that instance's thread directly.
- **R3** 🎯 Open an agent with **≥2 live** instances → the instance picker.
- **R4** 🎯 A lone **terminal** instance does NOT route to a dead thread — opening the agent gives the
  type-view (terminal instance is not counted).
- **R5** 🎯 `[1 running, 1 stopped]` → opens the **single live** thread (count = 1, not the picker).

## 5. Instance picker

- **PK1** 🎯 Picker lists only **live** instances. A `stopped`/`done`/`rejected` instance does NOT
  appear.
- **PK2** 🎯 Picker header `liveCount` equals the number of rows shown (no "1 active" over 2 rows).
- **PK3** 🎯 An errored instance appears in the picker (red) until acknowledged.

## 6. Terminal handling (recede / stay)

- **T1** 🎯 `done` worker instance recedes from all live lists after the linger.
- **T2** 🎯 `stopped` worker instance recedes (neutral, not red).
- **T3** 🎯 `rejected` worker instance recedes (neutral, not red) and does NOT appear in the picker.
- **T4** 🎯 `error` instance **stays** visible (red) in pipeline + card + picker until acknowledged.
- **T5** ✅ A receded instance is NOT deleted from the DB (still present in board data for tree/dedup);
  it is only gone from live surfaces. (Assert via the board API / re-scan dedup, not the UI.)
- **T6** 🎯 There is **no history surface** and **no restart** affordance on a receded instance.

## 7. The `error` acknowledge action  🎯 (new — not built)

- **A1** Errored run renders an **"OK / Got it"** affordance (same slot as gate approve/reject).
- **A2** Clicking OK transitions the run off `error` → it **recedes** from live (pipeline, card,
  picker) exactly like an approved run leaves.
- **A3** Before OK, the errored instance keeps START available on the input agent (error ∉ isBusy).
- **A4** An **input-scan** error does NOT need OK — a re-START supersedes it (assert it's gone after
  re-scan).

## 8. Open instance thread (modal)

- **TH1** ✅ Thread shows ALL runs of the instance inline as one stream (e.g. a `done` "draft saved"
  run + a live run).
- **TH2** 🎯 When the last live run goes terminal while the modal is open, the modal **stays open**
  (no auto-close); the **Stop button disappears**.
- **TH3** ✅ Stop in the thread cancels only the live runs (a `done` sibling is untouched).
- **TH4** 🎯 Closing a now-terminal instance and re-opening the agent gives the descriptive type-view.
- **TH5** ✅ The post-approval confirmation message (`onResume`) appears in the SAME open thread right
  after approval.

## 9. HITL approval flow

- **H1** ✅ Reply agent reaches awaiting-approval; the draft (ApprovalDialog) renders in the thread.
- **H2** ✅ Approve → server creates the Gmail draft (effect) → resume run → confirmation text → `done`.
- **H3** ✅ Reject → run → `rejected` (recedes neutral per T3); NO Gmail mutation.
- **H4** ✅ Concurrent HITL: two reply instances both show working Approve buttons (needs
  `DEV_RECORD_REPLAY=record` for distinct ids; replay caveat applies).
- **H5** ✅ Batch agent (reader/spam/important) gate: per-row actions, change a row, approve → applied.

## 10. Resume modes  🎯 (generalize `onResume` — not built)

- **RM1** `onResume` returns `{kind:'prompt'}` → model runs, emits a tail message, then `done`
  (today's behavior).
- **RM2** `onResume` returns `{kind:'message', text}` → the verbatim text is appended (NO model spawn)
  then `done`.
- **RM3** `onResume` returns `null` → **silent** `done`, no turn, and **no "Resume failed"** chunk.
- **RM4** (regression guard) the current `null`→"Resume failed" ugliness is gone after RM3 lands.

## 11. Handoff / thread order

- **HO1** ✅ A `→ Handed to X` line renders at its dispatch position in the parent scan thread (by
  `seq`), and never floats above the INBOX-SORTED card during streaming.
- **HO2** ✅ A deduped (covered) route does NOT render a visible handoff note (it's in the card's
  handled tally, not a timeline note).
- **HO3** ✅ "Open X" on a handoff note opens the child (cross-agent), even when the child is already
  `done`/`stopped` (the note is history, not live status).
- **HO4** ✅ `← Received from <parent>` shows at the top of a child thread.

## 12. Input agent scans & re-scan

- **S1** ✅ First scan: card reads `Read N · N new`, no handled row; handoff count = `new`.
- **S2** ✅ Re-scan after Stop + one new email: card reads `Read N · 1 new · K already handled`; only
  the new destination shows a `new:` chip; handoff count = `new` (one visible handoff).
- **S3** 🎯 **No stacked scans:** re-START with prior reply drafts still awaiting approval → the input
  thread shows **only the latest scan's content**, not multiple INBOX-SORTED cards. (This is the bug
  in the screenshots: header "3 runs" with 3 stacked scans.)
- **S4** ✅ A finished scan with live descendants is NOT superseded (children not orphaned) — assert
  the child drafts remain reachable after re-scan.
- **S5** ✅ A truly-finished scan with no live descendant IS superseded by re-START (no done-scan
  pile-up).
- **S6** ✅ One live scan blocks a second concurrent scan (one-open gate): re-START while a scan is
  self-live returns the live scan, no duplicate.

## 13. Dedup / covering (behavioral, assert via re-scan)

- **D1** ✅ `done` source COVERS: a re-scan does NOT re-dispatch a done email.
- **D2** ✅ `stopped` source COVERS: a re-scan does NOT re-dispatch a stopped email.
- **D3** 🎯/✅ `rejected` source does NOT cover: a re-scan **re-offers** the email to reply for a fresh
  draft. *(This is the reason rejected stays a distinct outcome — assert the re-draft appears.)*
- **D4** ✅ `error` source does NOT cover: a re-scan re-dispatches the failed email.
- **D5** ✅ Re-pasting / re-scanning an already-handled source returns `{deduped:true}`, no second
  child.

## 14. Concurrency

- **CC1** ✅ `maxInstances` caps concurrent instances per agent (reply = 2): a 3rd same-tick delivery
  queues (`queued: 1`), not 3 active.
- **CC2** ✅ A freed slot auto-starts a queued instance.
- **CC3** ✅ Singleton agents (sorter, qualifier = maxInstances 1) never run two at once.

## 15. Future (scaffold only — out of current E2E scope)  🔮

- **F1** Inter-agent ask/wait: an orchestrator suspends in a `awaiting_agents` (live) phase, shown
  "Working", resumes when child results arrive.
- **F2** Join: orchestrator waits on TWO children, resumes only when both terminal.
- **F3** Explicit input-field agent: paste N ticket links → one input run → N dispatches; dedup by
  `ticket:owner/repo#id`; `rerun:'append'` (each START is new work, no supersede).

---

# Additional cases — from a code walk (added 2026-06-17)

The sections below (16–26) are NET-NEW candidates surfaced by walking the actual runtime, UI, and
workflow code; none restate a §1–§15 case. Each carries a short `[file:line]` anchor (this is a
hand-off for the test author). Same tag legend (✅ current / 🎯 target / 🔮 future).

## 16. Gate idempotency & effect failure  (extends §7/§9)

- **GE1** ✅ **Double-approve fires the effect once.** Approve twice (same `formRev`): the ledger
  claim is `INSERT … ON CONFLICT`, so the 2nd approve returns `ok:true` from the cached `claim.result`
  and the effect spy fires exactly once. `[pipelineService.ts:386-401; stateStore.ts:164-181]`
- **GE2** 🎯 **Effect throws → `terminal/error`, no partial ledger.** When the server-executed effect
  throws, the run settles `error`, the ledger result is NOT written, no resume runs, and the failure
  shows in the audit trail + work-item error. `[pipelineService.ts:392-426]`
- **GE3** ✅ **Stale `formRev` → 409, gate untouched.** Approve with an older `formRev` → `409
  Conflict`; gate stays open, no effect, ledger untouched. `[pipelineService.ts:381-383]`
- **GE4** ✅ **Two concurrent approvals, distinct keys → each effect once.** Two work-items awaiting
  (keys `wi1:gate1`, `wi2:gate2`) approved concurrently → both effects fire exactly once, no
  cross-contamination. `[pipelineService.ts:346,385-386]`
- **GE5** ✅ **Audit trail captures resolved + effect + error.** A full approve→effect→resume→done
  flow writes `resolved`, `effect` (on first claim), and any `error` rows, attributed to the actor.
  `[pipelineService.ts:358-463]`
- **GE6** ✅ **Pool slot stays held while a gate is open.** On `GATE_OPENED` the observer suspends to
  `awaiting_human` and `reconcile`s — the slot is still occupied (not freed), so an agent at
  `maxInstances` with all instances awaiting blocks a new dispatch into the queue until one resolves.
  `[runObserver.ts:204-229; pipelineService.ts:119-122]`

## 17. Cancel semantics  (extends §6/§8)

- **CN1** ✅ **Cancel a terminal parent does not re-cancel it, but cascades to live children.** Stop on
  a `done` parent leaves the parent terminal and stops only its still-live children.
  `[pipelineService.ts:159-183]`
- **CN2** ✅ **Cancel a queued item → `pool.dequeue` → `terminal/stopped` directly** (never enters
  active). `[pipelineService.ts:164-165; transition.ts:51]`
- **CN3** ✅ **Cancel from `awaiting_human` resolves the open gate** (comment "cancelled") AND settles
  `stopped` — gate + status change together; no effect runs. `[pipelineService.ts:166-167]`

## 18. Dispatch races & limits  (extends §14)

- **DR1** ✅ **Finish-vs-dispatch reopen.** A child dispatch that lands the instant the parent finishes
  (`done`) calls `transition(reopen)` → parent lifts back to active and stays active until the child
  finishes; it never visibly flips terminal. `[dispatch.ts:95-100; transition.ts:55-59]`
- **DR2** ✅ **Reopen from a non-`done` outcome throws.** Same race but parent is `stopped` → `reopen`
  throws `IllegalTransition`, the child insert rolls back, the dispatch returns an error (not success).
  `[transition.ts:81-85; dispatch.ts:98-100]`
- **DR3** ✅ **Depth cap boundary.** Dispatch at `DEPTH_CAP-1` succeeds; the next dispatch at the cap
  throws `DepthExceeded`. `[dispatch.ts:13,75-77]`
- **DR4** ✅ **`source:null` never dedups.** A dispatch with no source mints a fresh queued item even
  if an identical prior item exists (no `{deduped:true}`). `[dispatch.ts:66-73]`

## 19. SSE ordering & reconnect  (extends §8; formalizes the storm gotcha)

- **SS1** ✅ **Terminal close is deferred until the backlog flushes.** A run that goes terminal while a
  client is subscribed keeps the stream open until all prior `seq` trace events have written, then
  closes — the final card never drops. `[routes.ts:88-104,128-131]`
- **SS2** ✅ **Attach to an already-terminal item: backlog + status, then close, no live tail.**
  `[routes.ts:128-131; useWorkItemThread.ts:51]`
- **SS3** 🎯 **`Last-Event-ID` reconnect resumes from `seq+1`** with no duplicated event.
  `[routes.ts:73-75]`
- **SS4** ✅ **Thread SSE auto-closes on terminal phase (no reconnect storm) and refetches the full
  trace on `error`.** `[useWorkItemThread.ts:55-66,71-87]`

## 20. Lossless trace — bad args / bad target  (extends §11)

- **LT1** ✅ **Malformed render-tool JSON args → card skipped, run continues.** A tool call whose args
  don't parse is caught; the card isn't updated but the trace stays lossless and the run progresses.
  `[runObserver.ts:142-149; buildRenderToolCall.tsx:20-24]`
- **LT2** ✅ **Dispatch to an unknown target → synthetic warning in the trace, run continues** (model
  sees the warning, no crash). `[runObserver.ts:186-197]`

## 21. Workflow — sorter dispatch & app-computed counts  (extends §12/§13)

- **WS1** ✅ **One `route_emails` per destination group, not per email.** 7 emails → 4 destination
  groups → 4 `route_emails` calls (empty groups omitted), reply still one-per-sender.
  `[email-inbox/prompts.ts:23-28; .cassettes/email-inbox__sorter.jsonl]`
- **WS2** ✅ **Dispatch-before-render order:** all `route_emails` calls precede `renderSort` in the
  stream. `[plans/2026-06-17-sorter-scan-result-counts.md:487]`
- **WS3** ✅ **Payload shape:** `to:'reply'` carries a singular `email`; batch destinations carry
  `emails:[…]`. `[mcp/inbox-tools.mjs:72-78; email-inbox/prompts.ts:24-27]`
- **WS4** ✅ **`renderSort` is prose-only.** The tool accepts `{summary:string}` only — no `counts`
  key is present or accepted. `[email-inbox/client.tsx:44-49; renders.test.ts:20-23]`
- **WS5** 🎯 **Card headline is app-computed and window-scoped.** `Read N · M new · K already handled`
  is derived from the OPEN scan's handoffs (M = new handoffs, K = deduped/covered) — never the model's
  numbers, never cumulative across scans. `[email-inbox/scanResult.ts:27-43; SortSummaryCard.tsx:12-22]`
- **WS6** ✅ **`EmailRef` requires `messageId/threadId/from/subject`** — a route call missing one is
  rejected and the model retries. `[mcp/inbox-tools.mjs:40-47; contracts.ts:14-21]`

## 22. Workflow — reply agent contract  (extends §9)

- **WR1** ✅ **Reply opened with no handoff → help text, no tools** ("You do not read the inbox — the
  Email Sorter does"). `[email-inbox/prompts.ts:54-59; prompts.test.ts:65-70]`
- **WR2** ✅ **Reply reads the body itself via `get_email`** (not pre-attached in the handoff summary).
  `[descriptor.ts:37; prompts.ts:42; descriptor.test.ts:19-20]`
- **WR3** ✅ **`saveDraft` is mandatory and the body lives in the tool args, not the prose** — the turn
  must not end without it. `[email-inbox/prompts.ts:45-51]`
- **WR4** 🎯 **Edited body flows to the effect.** Editing the ApprovalDialog textarea then approving
  sends the edited body to `createDraft`. `[ApprovalDialog.tsx:27; server.ts:71-74]`
- **WR5** ✅ **Reject runs no effect** — no `createDraft`, no Gmail mutation. `[server.ts:64,76]`

## 23. Workflow — batch agents (reader/spam/important)  (extends §9)

- **WB1** ✅ **Batch opened with no handoff → help text, no `applyActions`.**
  `[email-inbox/prompts.ts:105-110; prompts.test.ts:95-99]`
- **WB2** ✅ **Per-agent defaults:** reader=`read`, spam=`trash`, important=`star`.
  `[descriptor.ts:46-63; prompts.ts:131-133]`
- **WB3** ✅ **Per-row edit + live "Apply N action(s)" count** (changing one row leaves the others;
  count = non-`keep` rows). `[EmailBatchCard.tsx:29-32,41]`
- **WB4** ✅ **Approved form carries the EDITED rows to the effect.** `[EmailBatchCard.tsx:27,41;
  apply-actions.ts:36-46]`
- **WB5** ✅ **`keep` = no-op** (not sent to Gmail; `applied` still counts it as handled).
  `[apply-actions.ts:48-52; apply-actions.test.ts:35,42]`
- **WB6** ✅ **Best-effort partial failure:** one bad row → `{applied, failed:[{messageId,error}],
  byAction}`, the rest still apply. `[apply-actions.ts:55-66; apply-actions.test.ts:47-67]`
- **WB7** ✅ **Wholesale failure (no creds) → `{applied:0, failed:[], error}`** (not a false applied
  count). `[apply-actions.ts:68-72; apply-actions.test.ts:69-80]`
- **WB8** 🔮 **A batch row can be re-routed to reply** (reader/spam/important all list `reply` in
  handoffs). `[descriptor.ts:57]`

## 24. Safety guarantees (regression locks)  🔒

- **SF1** ✅ **Per-agent tool allow-lists are disjoint by role:** sorter = `{list_unread, renderSort,
  route_emails}`; reply = `{get_email, renderLead, saveDraft}`; batch = `{applyActions}`.
  `[email-inbox/server.ts:57,63,86]`
- **SF2** ✅ **Draft-only: there is NO send tool** — the only Gmail write the model can cause is
  `createDraft` (status DRAFT). `[server.ts:71-74; mcp/gmail-tools.mts:3-4]`
- **SF3** ✅ **GitHub board is READ-ONLY** — the github adapter exposes only `item-list`/`issue view`;
  no mutation path exists from any agent. `[github-tools.mjs]`

## 25. Demo-mode safety  (new)

- **DM1** ✅ **Demo `saveDraft` returns a fake `demo-N` draftId, no Gmail call.** `[server.ts:34-35;
  server.demo.test.ts:7-14]`
- **DM2** ✅ **Demo `applyActions` returns fake success counts (`byAction`), no Gmail call.**
  `[server.ts:36-46; server.demo.test.ts:16-33]`

## 26. UI surfaces — additional render/connection states

**Pipeline (extends §1):**
- **P9** ✅ Empty pipeline shows the "No agent is running yet" placeholder. `[PipelineColumn.tsx:124-126]`
- **P10** ✅ An instance with ≥2 runs shows a "· N" run-count badge. `[PipelineColumn.tsx:171-173,206-208]`
- **P11** 🎯 Stop affordance reveals on hover only for stoppable (running/awaiting) rows; terminal rows
  show none. `[PipelineColumn.tsx:27,61-62,86-89]`

**Agent card (extends §2):**
- **C7** 🎯 Terminal pill shows the distinct word (Stopped/Rejected), not a generic "Done".
  `[AgentCard.tsx:40-43; statusDisplay.ts:31-35]`
- **C8** 🎯 Unhealthy creds: START disabled + inline error icon/hint on the card.
  `[AgentCard.tsx:62-65,86-88,111-116]`
- **C9** ✅ Input agent shows "Start over" in the footer while actively running (alongside Stop).
  `[AgentModal.tsx:114-118]`

**Picker (extends §5):**
- **PK4** 🎯 Picker pill colors reflect status+outcome (err red / await amber / run blue / done grey).
  `[InstancePickerModal.tsx:66; statusDisplay.ts:34-35]`

**Instance view / thread (extends §8):**
- **IW5** ✅ Multi-run instance shows an "N runs" header badge + a thin separator between runs.
  `[InstanceView.tsx:60,71]`
- **TH6** ✅ Typing indicator (animated dots) shows while `running`. `[ThreadItems.tsx:149-160]`
- **TH7** ✅ Intro bubble renders once at the top when the agent defines intro text.
  `[ThreadItems.tsx:146; IntroBubble.tsx:8-15]`
- **TH8** ✅ Dev mode (`aiw.dev`) reveals internal tool calls as raw chips; OFF hides them with no
  phantom flex gap. `[buildThreadItems.ts:88-90; ThreadItems.tsx:106-110]`
- **TH9** ✅ A `role:'system'` lifecycle message renders as a banner (e.g. "Stopped by user").
  `[buildThreadItems.ts:46-49; ThreadItems.tsx:78-83]`

**Handoff (extends §11):**
- **HO5** ✅ "Open X" on a cross-workflow handoff calls `onOpenWorkflow` (not `onOpenInstance`).
  `[RunView.tsx:49-64]`
- **HO6** ✅ Handoff label falls back to the child `workItemId` when the child instance is gone.
  `[RunView.tsx:56-57]`

**Connection & empty states (new):**
- **CX1** 🎯 "Reconnecting…" chip appears in the app header (board SSE drop) and in the modal header
  (thread SSE drop). `[AppHeader.tsx:66-71; AgentModal.tsx:87-92]`
- **CX2** ✅ Activity panel shows "No activity yet" when the feed is empty. `[ActivityPanel.tsx:237-241]`
- **CX3** ✅ `useHealth` refetches creds on mount and window focus (post-OAuth refresh); the card
  prefers fresh health over the board snapshot. `[useHealth.ts:12-24; BoardInner.tsx:67-69]`

---

## Coverage checklist (for the E2E author)

Every TARGET (🎯) case encodes a fix that is NOT yet in the code — write it, expect red, and it turns
green when the matching fix from the spec lands. Group order to implement against:

1. Single `isLive` migration → unlocks C2/C3/R1–R5/PK1/PK2/T1–T3.
2. Completion animation → P7, T1–T3 timing.
3. `error` acknowledge → A1–A4, T4, PK3.
4. Input thread = latest scan → S3.
5. Color recolor (rejected/stopped neutral) → T2/T3 color, C6.
6. Resume modes → RM1–RM4.

The ✅ cases are regression guards — they must STAY green through every fix.
