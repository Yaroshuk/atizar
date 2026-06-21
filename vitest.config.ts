import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

const src = (p: string) => fileURLToPath(new URL(p, import.meta.url))

export default defineConfig({
  plugins: [react()],
  // Resolve @atizar/* to their `./src` for the monorepo's own tests (no pre-build needed). We use
  // explicit ALIASES rather than the `atizar-src` export condition (used by tsc + the client
  // vite.config) because a global `resolve.conditions` in vitest would switch Vite to CLIENT
  // resolution and pull in `browser`, flipping deps like decode-named-character-reference to their
  // DOM build (which touches `document` at eval and breaks the `@vitest-environment node` tests).
  // Order matters: more-specific subpaths before their package root.
  resolve: {
    alias: [
      { find: /^@atizar\/core$/, replacement: src('./packages/core/src/index.ts') },
      { find: /^@atizar\/providers$/, replacement: src('./packages/providers/src/index.ts') },
      {
        find: /^@atizar\/providers\/ids$/,
        replacement: src('./packages/providers/src/provider-ids.ts'),
      },
      {
        find: /^@atizar\/providers\/mastra$/,
        replacement: src('./packages/providers/src/mastra.ts'),
      },
      { find: /^@atizar\/server$/, replacement: src('./packages/server/src/index.ts') },
      {
        find: /^@atizar\/server\/mastra$/,
        replacement: src('./packages/server/src/mastraTools.ts'),
      },
      {
        find: /^@atizar\/server\/db\/schema$/,
        replacement: src('./packages/server/src/db/schema.ts'),
      },
      { find: /^@atizar\/react$/, replacement: src('./packages/react/src/index.ts') },
    ],
  },
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
    globalSetup: ['./packages/server/src/db/test-global-setup.ts'],
    include: ['apps/inbox/**/*.test.{ts,tsx,mjs}', 'packages/*/src/**/*.test.{ts,tsx}'],
    css: true,
    server: {
      deps: {
        inline: [/@copilotkit\//],
      },
    },
  },
})
