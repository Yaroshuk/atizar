# Code Conventions

The things Prettier/ESLint can't enforce — *how* we write code. Adopted from the
Magma house style (`teachers-web/docs/coding-rules/`, `parents-web/.claude/skills/rules/`),
filtered to the subset that fits this project's stack (CopilotKit + AG-UI + plain
React, no Effector / React Native / `@magmamath/ui` / i18n).

Formatting (quotes, semicolons, width, commas) lives in `.prettierrc`; correctness
rules in `eslint.config.js`. This file is everything else.

## Components

- **Arrow-function consts, named export. No default exports.**
  ```tsx
  export const AgentCard = (props: AgentCardProps) => { ... }
  ```
  Not `export function AgentCard()`, not `export default`.
- **One component per file — strictly.** Each component lives in its own file
  named after it. No second component in the file, even a small wrapper (e.g.
  `App` renders `<InboxView/>` from its own file; they are not co-located). The
  file name matches the component (`InboxView.tsx` → `InboxView`).
- **Props: a separate named `type {ComponentName}Props`** above the component —
  never an inline anonymous object in the parameter position.
  ```tsx
  type AgentCardProps = {
    name: string
    status: Status
    onStart: () => void
  }
  export const AgentCard = ({ name, status, onStart }: AgentCardProps) => { ... }
  ```

## Hooks

- React hooks follow the component rule: **arrow-function const, named export**,
  `useX` name (`useAgentStatus`, `useInboxActions`).
- Return a value directly when there's one thing to return; an object when there
  are several. Don't wrap a single return in an object.

## Pure functions (core/, server/)

- **`function` declarations are fine here** — these are framework-free utilities
  and predicates (`hasPendingApproval`, `pairToolResults`, `buildAgent`). The
  arrow-const rule is for the React layer (`client/`), not pure modules.
- This is the one deliberate split from the components rule: React-facing code is
  arrow consts; pure `core/`/`server/` code may use declarations (hoisting +
  readable stack traces, and both Magma repos do the same for utilities).

## Types

- **`type`, never `interface`.**
- **No `any`** in app code — use real types or `unknown` + a guard. Exceptions are
  scoped and commented (see `eslint.config.js`: tests; `renderRegistry`'s
  heterogeneous registry).
- **Named types for generic parameters** — no anonymous object types inside `<>`.

## Naming

- **Booleans:** prefix with `is` / `has` / `can` / `should`.
- **Event handlers / callbacks:** name by the action, not the trigger —
  `closeModal`, `sendReply`, not `handleClick`. Prop callbacks use `onX`
  (`onStart`, `onApprove`, `onClose`).
- **Files:** PascalCase for components (`AgentModal.tsx`), camelCase for hooks and
  utilities (`useAgentStatus.ts`, `messages.ts`).

## Structure inside a component

Order, top to bottom: imports → types → hooks (router/context, then state, refs,
effects) → derived values → early returns (loading / empty / error) → event
handlers → JSX. Define handlers before the `return`, not inline in JSX (small
inline lambdas like `onClick={() => setOpen(true)}` are fine).

## General

- **Comment *why*, not *what*.** No TODO without a tracked reference.
- Prefer **early returns** over nested conditionals; **no nested ternaries**.
- Prefer **array methods** and **`Record` lookup maps** over `switch` / long
  `if`-chains.
- `import type { … }` for type-only imports.

## Imports

- Group: external packages → internal modules → relative/co-located (styles,
  siblings).
- **Relative imports are kept** (no path alias). Rationale: `core/` lives *outside*
  `client/src/` (it's shared by client + server), so a single `src`-rooted alias
  wouldn't cover it cleanly. Revisit if/when the `@atizar/*` package split lands.

## Not adopted from Magma (different stack)

Effector class models (`Model.ts` + `model.ts`, constructor DI), React Native
primitives, `@magmamath/ui` + CSS-module design tokens, `i18next`, centralized
`testIds`, the static-class API layer. We use CopilotKit/AG-UI, inline styles, and
English-only strings instead.
