import { cpSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import dts from 'vite-plugin-dts'

// The drizzle migration files (SQL + meta/_journal.json) are runtime assets, not code, so the
// bundler does not emit them. runMigrations() resolves them at `dirname(import.meta.url)/migrations`
// = `dist/migrations` in the published artifact, so a consumer's `createServer({ start:true })`
// crashes ("Can't find meta/_journal.json") unless we copy them into dist. They ship via the
// `files: ["dist"]` whitelist once present here.
const copyMigrations = (): Plugin => ({
  name: 'atizar-copy-migrations',
  closeBundle() {
    cpSync(resolve(__dirname, 'src/db/migrations'), resolve(__dirname, 'dist/migrations'), {
      recursive: true,
    })
  },
})

// Library build for the PUBLISHED @atizar/server artifact (ESM + rolled-up .d.ts). See
// @atizar/core's vite.config for the rationale: the monorepo still consumes `./src` via the
// `development` condition; only the published artifact builds. Every bare import (node builtins,
// hono, drizzle, postgres, the optional pglite peer) is externalized — we ship only our own code.
export default defineConfig({
  plugins: [dts({ include: ['src'], rollupTypes: true }), copyMigrations()],
  build: {
    lib: {
      entry: {
        index: resolve(__dirname, 'src/index.ts'),
        'db/schema': resolve(__dirname, 'src/db/schema.ts'),
        mastra: resolve(__dirname, 'src/mastraTools.ts'),
      },
      formats: ['es'],
    },
    rollupOptions: {
      external: (id) => id.startsWith('@atizar/') || !/^[./]/.test(id),
    },
    sourcemap: true,
    emptyOutDir: true,
  },
})
