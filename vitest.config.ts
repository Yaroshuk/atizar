import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // Anchor the project root to this file's directory so include globs
  // (apps/inbox/**, packages/*/**) resolve identically whether vitest is
  // invoked from the repo root (`yarn test`) or an app dir with
  // `-c ../../vitest.config.ts` (`yarn workspace inbox test`).
  root: import.meta.dirname,
  test: {
    environment: 'happy-dom',
    globals: true,
    setupFiles: ['./apps/inbox/client/src/test/setup.ts'],
    // Pipeline tests hit a SEPARATE Postgres database from the dev server, so leftover test
    // rows never reach the dev server's startup sweep (which would re-enqueue them and spawn
    // real provider runs). globalSetup creates + migrates it once.
    env: {
      DATABASE_URL:
        process.env.TEST_DATABASE_URL ??
        'postgres://aiworkflow:aiworkflow@localhost:5432/aiworkflow_test',
    },
    globalSetup: ['./apps/inbox/server/pipeline/db/test-global-setup.ts'],
    include: ['apps/inbox/**/*.test.{ts,tsx,mjs}', 'packages/*/src/**/*.test.{ts,tsx}'],
    css: true,
    server: {
      deps: {
        inline: [/@copilotkit\//],
      },
    },
  },
})
