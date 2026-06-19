# Handoff — fix `yarn ui` (e2e) on `feat/framework-extract` (PR #2 → master)

## TL;DR
`yarn ui` (Playwright e2e in `apps/inbox`) has ~7 failing specs because the demo cassette now makes
the sorter dispatch **two** reply emails (Sam + Priya) with **per-sender** cassettes, while the e2e
suite was written for **one** reply + a single shared reply cassette. **Do NOT revert the cassettes.**
Writing e2e against a cassette is fine; the bug is that ONE cassette set serves BOTH the live demo
and the test suite, and some specs hard-assert the reply count. Fix the relationship, keep the
2-reply cassettes.

## Branch / where to work — IMPORTANT
Do everything on **`feat/framework-extract`** (the branch open as PR #2 → master:
https://github.com/Yaroshuk/atizar/pull/2). That branch has the framework changes **and** the
2-reply cassettes, and that is where `yarn ui` is currently red. Keep `feat/demo-site` (the deployed
demo on atizar.io) out of scope — it just needs to stay deployable.

## Current state (2026-06-19)
- Live demo: https://atizar.io on Fly (`feat/demo-site`, `DEMO=1`, one always-on 1GB machine). Working.
- `feat/framework-extract` (PR #2) has: deploy seam (staticDir/PORT/0.0.0.0), multi-tenant `sessionId`
  scoping, Mastra-free boot (`@atizar/server/mastra` subpath), `AppHeader` logoSrc/brandHref,
  `session.ts`, recordReplay `keyOf` seam — PLUS the 2-reply cassettes + `sorter-dispatch.test.ts` +
  `build-agent` keyOf wiring.
- `yarn test` (vitest) green (730). `yarn ui` (Playwright) RED — vitest does not run e2e.

## Mechanism recap (so you don't relearn)
`DEMO=1` → `isDemo()` → `build-agent.ts` wraps each agent provider with `withRecordReplay(mode:'demo')`
→ replays `apps/inbox/demo-cassettes/<key>.jsonl`, never calls claude/Gmail. Cassette key = `wf__agent`,
except reply, where `build-agent`'s `demoCassetteKeyOf` keys per email `messageId` (the `keyOf` seam in
`packages/server/src/recordReplay.ts`). Missing cassette in demo → throws `DemoCassetteMissing` (strict).
`yarn ui` boots the stack via `playwright.config.ts:43` `webServer.command = 'DEMO=1 yarn dev'`
(serial, `workers:1`, per-test reset in `e2e/fixtures.ts`).

## Root cause of the failures
1. **Count-coupled specs** assume the sorter emits exactly ONE reply — e.g. "after **the only** reply
   finishes its card reads idle", episode-scoping ("reply does not resurrect a prior episode's done
   draft"), "an approved (done) reply instance leaves the pipeline". Now there are 2 → they fail.
2. **Multi-instance specs** stage a 2nd reply via the API with a test `messageId`
   (`apps/inbox/e2e/pages/InboxBoard.ts` `stageSecondReply` ~line 103). With per-sender `keyOf`, a
   staged `messageId` has no cassette → `DemoCassetteMissing` → the reply run errors → 30s timeout.

## The fix — two parts, NO revert

### Part A — `keyOf` fallback to the shared cassette (packages/server/src/recordReplay.ts)
In `withRecordReplay`'s `run` AND `resume`: when `keyOf` yields a per-run key whose cassette is
MISSING, fall back to the base key (`opts.key`, e.g. `email-inbox__reply.jsonl`) before throwing
`DemoCassetteMissing`. So a reply staged with ANY `messageId` replays the shared cassette; the
per-sender files (`__demo-thread-4/5`) still give distinct content when present. This is a genuine
generic robustness improvement (graceful per-run keying), not a band-aid — fixes the timeouts.
- Add a unit test in `packages/server/src/recordReplay.test.ts`: per-run key missing → falls back to
  base key; both missing in demo → still throws `DemoCassetteMissing`.

### Part B — make the count-coupled e2e specs data-independent (apps/inbox/e2e/*.spec.ts)
`e2e/fixtures.ts` already resets per test, and `InboxBoard.stageSecondReply` already stages instances
via the API. Apply that discipline to the count-sensitive specs:
- A spec asserting "one reply" should **reset + stage exactly the reply instance(s) it asserts** and
  assert on THOSE — not on however many the sorter cassette emits.
- A spec that genuinely tests the sorter scan output (`sorter-scan.spec.ts`, `batch-approval.spec.ts`)
  → update expected numbers to the current cassette (sorter routes 5: reader 1 / spam 1 / important 1
  / reply 2; see the `renderSort` counts in `email-inbox__sorter.jsonl`).
- After Part A, staged replies replay regardless of `messageId`, so staging arbitrary senders works.

## Files
- Framework: `packages/server/src/recordReplay.ts` (+ `recordReplay.test.ts`).
- E2e: the failing `apps/inbox/e2e/*.spec.ts` (reply-approval, episode-scoping, instance-picker,
  agent-instances, "approved reply leaves pipeline"), `apps/inbox/e2e/pages/InboxBoard.ts`,
  `apps/inbox/e2e/fixtures.ts`.
- Cassettes (reference, do NOT revert): `apps/inbox/demo-cassettes/email-inbox__sorter.jsonl` (5
  routes), `email-inbox__reply.jsonl` (shared fallback), `__demo-thread-4.jsonl` (Sam),
  `__demo-thread-5.jsonl` (Priya).

## Verify (all on feat/framework-extract)
- `yarn typecheck` + `yarn test` green (≥730).
- `DEMO=1 yarn dev` (repo root), then `yarn workspace inbox ui` → all 30 Playwright specs green.
- Cassettes are synthetic; if touched, run `yarn workspace inbox demo:scan-cassettes`.
- Commit to `feat/framework-extract`; the human merges PR #2 to master (agent can't push master).

## Hard rules (CLAUDE.md — don't relearn)
- `apps/inbox/.cassettes/` = REAL data, gitignored, never commit (a hook blocks staging it).
  `apps/inbox/demo-cassettes/` = synthetic, committed — these are those.
- `DEMO=1` is strict replay: missing cassette throws (never falls back to real claude). Part A's
  fallback is to the SHARED cassette, never to claude.
- Browser-verify flows; `yarn test` does NOT cover e2e (`yarn ui` does).
