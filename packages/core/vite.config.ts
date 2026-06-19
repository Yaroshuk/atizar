import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import dts from 'vite-plugin-dts'

// Library build for the PUBLISHED @atizar/core artifact (ESM + rolled-up .d.ts). This is the one
// place the package has a build step — the in-monorepo demo + typecheck still consume the raw
// `./src/*` exports via the `development` condition (see package.json), so dev/HMR is untouched.
// Every bare import is externalized: the consumer resolves deps; we ship only our own code.
export default defineConfig({
  plugins: [dts({ include: ['src'], rollupTypes: true })],
  build: {
    lib: {
      entry: { index: resolve(__dirname, 'src/index.ts') },
      formats: ['es'],
    },
    rollupOptions: {
      external: (id) => id.startsWith('@atizar/') || !/^[./]/.test(id),
    },
    sourcemap: true,
    emptyOutDir: true,
  },
})
