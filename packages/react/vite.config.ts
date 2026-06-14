import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import dts from 'vite-plugin-dts'

// Library build for the PUBLISHED @atizar/react artifact (esm + rolled-up .d.ts + bundled CSS).
// This is the one place the package has a build step — the in-monorepo demo still consumes the
// raw `./src/*` exports (see package.json), so dev/HMR is untouched. `localsConvention` MUST
// stay `camelCaseOnly` to match the Phase-3 CSS-Module convention (components key class lookups
// via a camelize() helper); a mismatch silently breaks status-class resolution in the artifact.
export default defineConfig({
  plugins: [react(), dts({ include: ['src'], rollupTypes: true })],
  css: { modules: { localsConvention: 'camelCaseOnly' } },
  build: {
    lib: {
      entry: { index: resolve(__dirname, 'src/index.ts') },
      formats: ['es'],
    },
    rollupOptions: {
      // peers + workspace siblings must NOT be bundled — the consumer resolves them.
      external: [
        'react',
        'react-dom',
        'react/jsx-runtime',
        '@atizar/core',
        '@ag-ui/client',
        'zod',
        'clsx',
      ],
    },
    sourcemap: true,
    emptyOutDir: true,
  },
})
