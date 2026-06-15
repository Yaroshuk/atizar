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

## Component file & folder structure

These extend the one-component-per-file rule above with where a component's files live.

1. **One component per file — including private wrappers.** A file exports exactly one React
   component (plus its own `Props` type). No second component in the same file — not even a small
   private `Inner`/wrapper. Extract it to its own file. (Pure non-component helpers/hooks may live
   beside it per rule 2.)
2. **Folder per component.** A component lives in its own folder named for it:
   `ComponentName/ComponentName.tsx` + `ComponentName/ComponentName.module.scss` (its styles) + any
   component-local helpers / hooks / sub-components / tests in that same folder
   (`ComponentName.test.tsx`, `useComponentNameThing.ts`, …). A barrel `index.ts` is optional —
   prefer importing the file directly (`./ComponentName/ComponentName.js`). Truly shared
   helpers/hooks stay at the package top level (`hooks/`, models like `boardModel.ts`) — folder
   locality is for things used ONLY by that component.
3. **CSS Modules everywhere, including `apps/`.** Every component (package AND userland) owns its
   styles in a co-located `*.module.scss`. No component-specific rules in a global stylesheet. The
   only global CSS is the reset + cross-cutting layout shells + the `--atz-*` token layer
   (`tokens.css`). Import class names from the module (`import s from './X.module.scss'`) and merge
   an incoming `className` with `clsx`. Note `localsConvention: 'camelCaseOnly'` camelizes BOTH `-`
   AND `_` (`.card-top` → `cardTop`, `awaiting_approval` → `awaitingApproval`); a runtime
   status-keyed class needs a `camelize()` helper, and the convention must match in every Vite
   config that compiles the package's `*.module.scss` (the demo's `apps/inbox/vite.config.ts` and
   `packages/react/vite.config.ts`).

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

## Workflows: wire strings & prompts

A workflow (`apps/inbox/workflows/<id>/`) is **structure → descriptor, words → prompts.ts**.

- **Every wire string goes through a per-workflow const map**, never a TS `enum`
  (config-as-data, invariant I7 — `as const` keeps the value identical to the wire
  string). Each workflow owns its own maps:
  - `ids.ts` — the workflow id (`WORKFLOW_ID`), the agent ids (`*_AGENTS`), and role
    strings (`ROLES`).
  - `tools.ts` — the tool names (`*_TOOLS`), **including read tools** so the descriptor's
    `readonly` arrays and the prompts share one source (no raw literals anywhere).
  - `cards.ts` — the card/component names (`*_CARDS`).
  - Payload **contracts** (zod schemas) live in `contracts.ts` so `prompts.ts` can decode
    them without importing the descriptor (that would close a descriptor↔prompts cycle);
    re-export from the descriptor for consumers that treat it as the entry point.
- **The descriptor** (`descriptor.ts`) stamps `id`, `handoffs`, `role`, and `readonly`
  from those const maps — no raw `'email-inbox'` / `'reply'` / `'input'` / `'list_unread'`
  literals.
- **Prompts are authored with `definePrompt` from `@atizar/core`** — one flat block per
  agent (`{ input?, onInput?, onStart, onResume? }`); shared shapes use a single factory
  (e.g. `batchPrompt(defaultAction)`), never copy-paste. Prompts are **TURN-ONLY**: they
  carry the words for the current turn and nothing else.
- **Identity belongs to the descriptor, not the prompts.** `defineAgent.instructions`
  (composed with the workflow-level `prompt`) is the agent's identity; the provider
  **prepends** it to the turn-only `definePrompt` output at run time. Never re-bake
  `compose()`/identity into prompt prose.
- **A tool call in prompt prose is ALWAYS written `` Call ${t.x} `` ** (interpolate the
  const from `tools.ts`), never a bare hand-typed tool name. This is what lets the
  drift-guard test enforce that no raw tool literal slipped in.
- **A drift-guard test is required per workflow** (`prompts.drift.test.ts`): assert every
  tool-shaped token in the prompt prose is a value in `*_TOOLS`, every `handoffs` target is
  a value in `*_AGENTS`, and `descriptor.id === WORKFLOW_ID`.
- **The client scopes its specs with `scope(WORKFLOW_ID, …)`** (import `WORKFLOW_ID` from
  the workflow's `ids.ts`), never the literal workflow id.

## Not adopted from Magma (different stack)

Effector class models (`Model.ts` + `model.ts`, constructor DI), React Native
primitives, `@magmamath/ui` + CSS-module design tokens, `i18next`, centralized
`testIds`, the static-class API layer. We use CopilotKit/AG-UI, inline styles, and
English-only strings instead.
