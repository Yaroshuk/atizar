import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "happy-dom",
    globals: true,
    setupFiles: ["./client/src/test/setup.ts"],
    include: ["client/src/**/*.test.{ts,tsx}"],
    // CopilotKit's v2 entry imports a `.css` file; let Vite transform deps so
    // the CSS import is handled instead of hitting Node's ESM loader.
    css: true,
    server: {
      deps: {
        inline: [/@copilotkit\//],
      },
    },
  },
});
