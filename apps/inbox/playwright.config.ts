import { defineConfig, devices } from '@playwright/test'

// Browser E2E for the inbox DEMO app (mirrors the Magma teachers-web house style: Playwright,
// getByTestId, page objects, hit a RUNNING dev server — we do NOT boot the app here).
//
// This suite lives under apps/inbox (NOT in the @atizar/* framework packages) because it drives a
// concrete WORKFLOW's UI — the sorter scan, the reply approval, the INBOX SORTED card — which is
// app/workflow policy (I5). Generic @atizar/react component behaviour is covered by vitest
// component/hook tests inside packages/react.
//
// The app has no auth (deferred), so there is no setup/storageState project. Run the demo flow:
// `DEMO=1 yarn dev` serves the client on :5173 with committed synthetic cassettes
// (apps/inbox/demo-cassettes) + faked effects — fully deterministic, no real claude / Gmail.
//
// `webServer` below boots that stack for the run; if you already have `DEMO=1 yarn dev` up on
// :5173 it attaches to it instead.
//
//   yarn workspace inbox ui          (headed)
//   yarn workspace inbox ui:smoke    (headless)

const AIW_BASE_URL = process.env.AIW_BASE_URL || 'http://localhost:5173'

export default defineConfig({
  testDir: './e2e',
  testMatch: /.*\.spec\.ts$/,
  // The demo server holds ONE shared Postgres state and the sorter is a singleton — specs must run
  // serially (a per-test reset, see e2e/fixtures.ts, gives each a clean slate).
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: AIW_BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    viewport: { width: 1440, height: 900 },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  // Boot the demo stack for the run; reuse an already-running `DEMO=1 yarn dev` if present.
  webServer: {
    command: 'DEMO=1 yarn dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
})
