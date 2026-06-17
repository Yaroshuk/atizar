# Testing — how we test (TDD, the red→green ledger, layers, E2E)

This is the **project testing reference**. Read it before writing or reviewing tests. It exists
because an agent refused to write red tests for not-yet-built behavior and "simplified" tests until
everything was green — which destroys the whole point. Don't do that. The rules below are not
optional.

Process skills this builds on (use them, don't re-derive): **`superpowers:test-driven-development`**
(the red→green→refactor loop), **`superpowers:verification-before-completion`** (evidence before any
"done" claim), **`browser-verify`** (driving the real app + dev-server/Playwright recovery).

---

## 1. The red test is the point

**TDD is non-negotiable here:** write the failing test FIRST, watch it fail, then write the minimal
code to make it pass, then commit. A test you wrote *after* the code, or that has never been seen
red, proves nothing — it may be asserting the bug.

**Hard rules:**

- **Never write production code without a failing test first.** Watch it fail for the *expected
  reason* (not a typo/import error masquerading as failure).
- **Never weaken, simplify, delete, or `.skip` a test to make the suite green.** If a test is red,
  either the code is wrong (fix the code) or the test is wrong (fix the test *with a stated reason*).
  Making red go away by lowering the bar is a lie about the state of the system.
- **"The feature isn't built yet, so there's nothing to test" is WRONG.** That is exactly when you
  write the test — red, first. See §2.
- **Evidence before assertions.** Never say "done / passing / fixed" without pasting the command and
  its output. (`verification-before-completion`.)

---

## 2. Don't skip a test because the feature isn't built — write it red inside the feature's loop

A spec / case catalog (e.g. `docs/superpowers/specs/2026-06-17-agent-view-e2e-cases.md`) is the
**checklist of which tests to write**, split into:

- **✅ current** — behavior that exists today → **regression guards**; must be green and stay green.
- **🎯 target** — behavior **not built yet** → the test is the *definition of done* for that feature.

The fix for the anti-pattern that triggered this doc is **not** a separate "red bucket" you tag and
maintain — that's overhead. It's just real TDD: when you implement a feature, **its test is written
red first, in the same loop, then made green by the code.** Every plan in
`docs/superpowers/plans/` already spells out these steps (write failing test → run-to-fail →
implement → run-to-pass → commit). So a 🎯 test gets written exactly when its feature is built — red,
then green, together. You never carry a standing pile of red tests, and you never need a `@target`
tag or a separate run.

What IS forbidden:

- Skipping a 🎯 test with **"the feature isn't built, so nothing to test."** It IS the acceptance
  test — it gets written when you build the feature, red first. (This is the exact mistake that
  caused this doc.)
- Weakening / deleting / `.skip`-ing any test to turn red green **without implementing the
  behavior**.

If you ever genuinely must stage an acceptance test *ahead* of a fix another agent will land later,
that's allowed (it's red until then) — but prefer writing it inside that fix's own TDD loop so the
suite is never standing-red. No tag ceremony.

**Cheap deterministic red.** The most reliable red→green signal is usually a **unit test on the pure
projection/helper** the fix introduces (red with "module not found" / wrong output, green when
implemented) — pair it with the heavier browser acceptance.

---

## 3. Test layers — put each behavior where it belongs

| Layer | Tool | What goes here |
|---|---|---|
| **Unit** | vitest (`yarn test`) | Pure logic: the lifecycle classifier (`@atizar/core` `lifecycle`/`hasLiveDescendant`), dedup/`covers`, model/projection functions (`pipelineModel`, `aggregate`, `boardModel`, `currentEpisode`, `foldEventsToMessages`), prompt **drift guards**, `defineAgent` validation. **Most behavior lives here.** |
| **Server** | vitest + **PGlite** | Transitions/edges, `settle`, the dispatch chokepoint, `runObserver`, gate resolution. Skip if PGlite unreachable. |
| **Component** | vitest + Testing Library | A single component/card rendering given props/messages (e.g. `AgentModal`, a render-spec card, `ThreadItems` order). DOM order is unit-assertable; **animation/timing is not** (→ browser). |
| **Browser E2E** | Playwright (via `browser-verify`) | Full user flows end-to-end + the **"only the browser catches it"** class (§4). The consumer-visible truth. |

**Don't duplicate layers.** Server logic / dedup / lifecycle is verified at the unit/PGlite layer —
do **not** re-assert it through the browser. The browser is for *flows* and *render truth a unit
test cannot see*, not for re-testing the classifier.

**Decision rule:** can a pure function + a unit test express this behavior deterministically? Then it
belongs in unit, not the browser. Reach for the browser only for a real user flow or a
browser-only failure mode (§4).

---

## 4. "Only the browser catches it" — these MUST be browser-verified

These pass typecheck + unit tests while being broken in the running app. They are the legitimate
browser-E2E cases (detail in `CLAUDE.md` gotchas):

- Contiguous text deltas sharing **one `messageId`** (a fresh id per delta splits one bubble into
  many).
- CSS-Module `localsConvention: camelCaseOnly` status-keyed classes (unstyled status dots/pills).
- Generative-UI **render closures captured once** (a state-dependent callback silently no-ops).
- Per-WorkItem SSE **reconnect storm** on terminal status (starves other streams; a tail card never
  arrives).
- HITL approval flows, **concurrent** HITL (per-instance registration), the instance **cap leak**
  (route 3 at once → 2 active + `queued: 1`).
- Anything with **animation/linger/fade timing** (e.g. the completion animation) — the pure "which
  ids are leaving" diff is unit-tested; the *fade itself* is browser-only.

If a change touches any of these, "unit tests pass" is **not** done — browser-verify it.

---

## 5. Browser-E2E mechanics (project-specific)

- **Always go through the `browser-verify` skill.** It owns dev-server hygiene (killing stale stacks,
  freeing `:4000`/`:5173`, the self-reload diagnosis) and Playwright-MCP profile-lock recovery.
- **Deterministic runs via `DEV_RECORD_REPLAY`** (`docs/dev-record-replay.md`): `=1` replays
  cassettes instantly; `=record` forces real `claude` runs. **Caveat:** replay reuses a recorded
  `toolCallId`, so **concurrent HITL** shows a false "second button dead" — use `=record` for those.
  Unset = pure production path.
- **Dev mode OFF for consumer assertions.** `localStorage['aiw.dev']='1'` reveals raw tool chips;
  keep it off when asserting the consumer surface (cards-only).
- **Prefer `data-testid` over text** for stable selectors (text is i18n/copy-fragile). Add a testid
  when a flow needs one rather than matching prose.
- A target flow's spec is written **inside the feature's TDD loop** (red until the fix, green after),
  not pre-staged as a standing-red bucket (§2).

---

## 6. Cassette share-safety (HARD RULE)

A cassette holds **real captured email/ticket data**. Before committing / pushing / un-gitignoring
any cassette: warn explicitly it contains real data, run `scanCassette`
(`apps/inbox/server/record-replay.ts`) and report every finding with `file:line`, and wait for the
human to confirm/scrub. Names and postal addresses are not regex-detectable — the human is the final
reviewer. **Never share a cassette silently.**

---

## 7. Commands & the green gate

Run from the **repo root**:

- `yarn test` — vitest across the workspace (the canonical unit/server run; the regression gate).
- `yarn typecheck` — `tsc --build` across all packages + `apps/inbox`.
- `yarn lint` — ESLint (must be GREEN).
- `yarn format:check` — Prettier.
- `yarn workspace @atizar/react build` — required after any `@atizar/react` change (CSS/types).
- Playwright E2E — via the `browser-verify` skill.

**Green gate before claiming "done":** `yarn typecheck && yarn test && yarn lint &&
yarn format:check` (+ the react build for react changes), **plus** browser-verify for any §4 case.
Paste the output. No green gate, no "done".

---

## 8. Before you claim it works (checklist)

- [ ] Wrote the test first and saw it **red** for the expected reason.
- [ ] Behavior is at the **right layer** (didn't push browser-only-catchable into a unit test, or
      duplicate server logic into the browser).
- [ ] 🎯 target tests for unbuilt behavior are written **red inside the feature's loop**, not
      skipped with "nothing to test".
- [ ] No test was weakened/deleted to go green; any test change has a stated reason.
- [ ] Green gate run, output pasted; §4 cases browser-verified.
- [ ] Cassettes (if any) scanned before sharing.
