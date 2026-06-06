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
    files: ['**/*.test.*'],
    rules: {
      '@typescript-eslint/no-unused-vars': 'off',
    },
  },
  prettier,
  {
    ignores: ['node_modules', 'dist', 'coverage', '.playwright-mcp', '*.config.*'],
  },
)
