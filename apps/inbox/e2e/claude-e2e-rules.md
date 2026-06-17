# Inbox browser E2E — conventions (Playwright)

Mirrors the Magma teachers-web house style. The suite drives the **running demo app**; it does NOT
boot it.

## Run

```
# terminal 1 — the demo stack (synthetic cassettes, faked effects, no real claude / Gmail / auth)
DEMO=1 yarn dev          # from repo root, or: yarn workspace inbox demo

# terminal 2
yarn workspace inbox ui          # headed
yarn workspace inbox ui:smoke    # headless
yarn workspace inbox ui:report   # open the last HTML report
```

`AIW_BASE_URL` overrides the target (default `http://localhost:5173`).

## Layout

- `e2e/*.spec.ts` — specs (one user flow each). Only `*.spec.ts` is collected.
- `e2e/pages/*.ts` — page objects. Locator methods RETURN a `Locator` (no actions, no assertions);
  action methods guard with web-first assertions. Business assertions stay in the spec.

## Rules

- **Selectors: `getByTestId()` only.** No CSS / role / text selectors for app elements.
- **Test ids come from the shared catalogs — never inline a raw string** (collision-safe, one source):
  - generic UI ids → `testIds` from `@atizar/react` (`testIds.agentStart(id)`, `pipelineRow(id)`,
    `instanceModal`). Add new generic ids THERE (`packages/react/src/testIds.ts`).
  - app/workflow card ids → `appTestIds` from `apps/inbox/client/src/testIds.ts`
    (`approvalSave`, `sortHeadline`, …). Add new app ids THERE.
- **Waits: web-first assertions** (`await expect(locator).toBeVisible()`); guard clickables with
  `toBeEnabled()`. **Never** `page.waitForTimeout()`.
- Demo runs take a few seconds (a real agent stream replays from a cassette) — use generous
  per-assertion timeouts (20–30s) on the first post-action assertion, not blind sleeps.

## Adding a test id

1. Add the id to the right catalog (framework vs app, per the boundary above).
2. Reference it in the component via `data-testid={…}` (Button & friends spread `data-*`).
3. Reference the SAME catalog entry in the page object / spec.
