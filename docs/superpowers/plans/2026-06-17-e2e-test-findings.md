# E2E coverage — findings log (real defects surfaced by the new tests)

**Working agreement (2026-06-17):** we write the test coverage FIRST. A test that goes red because
it surfaces a real defect is recorded HERE — we do NOT fix the production code mid-coverage. Fixes
are batched and applied AFTER the relevant cases are covered, each ticking its finding to `fixed`.

A red finding is parked in its test as `it.fails(...)` (an expected-failure tripwire): it keeps
running, stays green-as-expected-fail, and FLIPS red the moment the fix lands — reminding us to drop
the `.fails` marker and close the finding here.

---

## F1 — a throwing effect hangs the run forever (instead of failing it)

- **Case:** §16 GE2 (`pipelineService.test.ts` → "GE2: an effect that THROWS …").
- **Status:** ✅ FIXED (2026-06-17) — `pipelineService.ts:399` now wraps the effect call in try/catch
  and routes a throw into the `{error}` path (settle→error, audit, gate closed). GE2 is green.
- **What:** `resolveGate` executes the approved effect at `pipelineService.ts:399`
  (`executedResult = await effect(...)`) with **no try/catch**. The effect contract is "return
  `{error}` on failure" — that path is handled (settle→`error`, audit, gate closes; lines 403–425).
  But if an effect **throws** (a real case: a Gmail/network client that throws instead of returning
  `{error}`), the exception propagates out of `resolveGate`:
  - the gate row was already marked resolved (`resolveGateRow`, line 398),
  - `setLedgerResult` never runs (line 400 skipped),
  - `settleEdge('fail')` never runs → the work item is **stuck in `awaiting_approval` forever**, with
    the gate already closed (no Approve/Reject affordance left). A dead-end for the user.
- **Evidence:** `packages/server/src/pipelineService.ts:386-401`.
- **Recommended fix (~5 lines, contract unchanged):** wrap the effect call so a throw routes into the
  same `{error}` path:
  ```ts
  try {
    executedResult = await effect(form, { workItemId: wi.id, gateId: gate.id })
  } catch (e) {
    executedResult = { error: e instanceof Error ? e.message : String(e) }
  }
  await store.setLedgerResult(key, executedResult)
  ```
- **Boundary note:** this is a `@atizar/server` (framework) change to the effect-execution path —
  run `check-foundation` before applying.
