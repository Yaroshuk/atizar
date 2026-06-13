import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import prettier from 'eslint-config-prettier'

// Flat config modeled on the Magma house style (parents-web), web-only:
// the React-Native handler restrictions are dropped. ESLint handles
// CORRECTNESS; Prettier owns FORMATTING (eslint-config-prettier last,
// disabling any stylistic rules that would fight the formatter).
export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-hooks/refs': 'off',
      'react-hooks/immutability': 'off',
      'no-console': 'warn',
      eqeqeq: ['error', 'always'],
    },
  },
  {
    // Tests use minimal stubs/fixtures cast to domain types — `any` is fine here.
    files: ['**/*.test.*'],
    rules: {
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  {
    // Server entry points legitimately log to the console (startup, etc.).
    files: ['**/server/**'],
    rules: {
      'no-console': 'off',
    },
  },
  {
    // MCP server scripts run in Node — expose Node built-in globals (Buffer, etc.)
    // and allow console for MCP stdio logging. Covers the app's own MCP scripts
    // (`apps/inbox/mcp/`) and the node-only `@atizar/integrations` package.
    files: ['**/mcp/**/*.mjs', 'packages/integrations/src/**/*.mjs'],
    languageOptions: {
      globals: {
        Buffer: 'readonly',
        process: 'readonly',
        console: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
      },
    },
    rules: {
      'no-console': 'off',
    },
  },
  prettier,
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/dist-types/**',
      '**/coverage/**',
      '**/.playwright-mcp/**',
      '**/*.config.*',
    ],
  }
)
