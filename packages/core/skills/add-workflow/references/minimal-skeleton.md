# Minimal App Skeleton

Templates for the five files the skill bootstraps when a consumer project has no existing skeleton.
These are the exact files needed before any workflow can be wired. All code targets the public SDK
only — no `@atizar/*` internal paths.

---

## Required packages

```json
{
  "dependencies": {
    "@atizar/core": "^0.x",
    "@atizar/server": "^0.x",
    "@atizar/react": "^0.x",
    "@atizar/providers": "^0.x"
  }
}
```

Optional: `@atizar/integrations` when you need a bundled integration (e.g. Gmail).

---

## Required env vars

```dotenv
# Postgres connection (required — the server writes pipeline state here)
DATABASE_URL=postgres://localhost:5432/myapp

# Provider selection: 'claude-cli' (dev) or 'mastra' (prod/CI)
PROVIDER=claude-cli

# Auth token for mutation endpoints (unset = dev/demo open — set in prod)
# ATIZAR_AUTH_TOKEN=...

# If PROVIDER=mastra: Anthropic API key
# ANTHROPIC_API_KEY=...
```

---

## `workflows/index.ts` — descriptor aggregator

```ts
import type { WorkflowDescriptor } from '@atizar/core'

// Add a workflow: import its descriptor and append it here.
export const workflowDescriptors: WorkflowDescriptor[] = []
```

---

## `server/workflows.ts` — server-binding aggregator

```ts
import type { WorkflowDescriptor } from '@atizar/core'
import type { ServerBindingLike } from '@atizar/server'

export type WorkflowServer = {
  descriptor: WorkflowDescriptor
  bindings: (workflowId: string) => ServerBindingLike[]
}

// Add a workflow: append { descriptor, bindings: yourWorkflowServer } here.
export const workflowServers: WorkflowServer[] = []
```

---

## `client/src/workflows.ts` — client render/HITL aggregator

```ts
import { scope, type WorkflowsConfig, type AgentMeta, type RenderSpec, type HitlSpec } from '@atizar/react'
import { workflowDescriptors } from '../../workflows/index.js'

// Add a workflow: spread its meta/renders/hitl into the three maps below (see Stage 3i).
const META: Record<string, AgentMeta> = {}
const renderSpecs: RenderSpec[] = []
const hitlSpecs: HitlSpec[] = []

export const workflowsConfig: WorkflowsConfig = {
  workflows: workflowDescriptors,
  meta: META,
  renders: renderSpecs,
  hitl: hitlSpecs,
}
```

---

## `server/index.ts` — server entry

Calls `createServer` from `@atizar/server` with the aggregators + provider registry and starts
listening. The provider registry tells the framework which factory to call for each provider name
declared in your agent descriptors.

```ts
import { createServer, buildAgentProvider, isDemo, atizarEnv, deriveConnectionList } from '@atizar/server'
import { defineProviders, type ProviderRegistry } from '@atizar/core'
import { createClaudeCliProvider, PROVIDERS } from '@atizar/providers'
import { workflowServers } from './workflows.js'
import { workflowDescriptors } from '../workflows/index.js'

// Minimal provider registry: claude-cli for dev; add a Mastra factory here when PROVIDER=mastra.
const providerRegistry: ProviderRegistry = defineProviders({
  [PROVIDERS.claudeCli]: (config) =>
    createClaudeCliProvider({
      instructions: config.instructions,
      approvalNames: config.approvalNames,
      surfaceTools: config.surfaceTools,
      allowedTools: config.allowedTools,
      prompts: config.prompts,
      // Inject a real spawn here; replace with makeClaudeSpawn(...) from @atizar/server.
      spawn: async () => { throw new Error('spawn not configured') },
    }),
})

// buildProvider delegates to the registry — add a DEV_RECORD_REPLAY wrap here if needed.
const buildProvider = (def: any, prompts: any, registry: ProviderRegistry, allowedTools: readonly string[], instanceKey: string, composedInstructions?: string) =>
  buildAgentProvider({ def, prompts, registry, allowedTools, instanceKey, composedInstructions })

// Derive the connections from the workflow descriptors (reads each workflow's integration list).
const connectionList = deriveConnectionList(workflowDescriptors)

void createServer({
  workflowServers,
  providerRegistry,
  buildProvider,
  connections: connectionList,
  scopesFor: () => [],               // add OAuth scopes per integration when needed
  enabledWorkflows: null,            // null = all workflows active
  instanceKeyOf: (agentId) => agentId,  // default: one instance per agent
  sourceOf: () => null,              // default: no dedup source
  start: true,
}).catch((err) => {
  console.error('[server] boot failed:', err)
  process.exit(1)
})
```

> **`spawn` is required for `claude-cli`.** Replace the placeholder above with a real spawn.
> The recommended factory is `makeClaudeSpawn` from `@atizar/server`:
>
> ```ts
> import { makeClaudeSpawn } from '@atizar/server'
> const spawn = makeClaudeSpawn({ mcpServers: [] }) // add MCP servers your agents need
> ```

---

## `client/src/main.tsx` — client entry

Mounts the `@atizar/react` provider + your board components. The package exports `WorkflowsProvider`
plus low-level board primitives (`PipelineColumn`, `AgentCard`, `AgentModal`, `WorkflowSwitcher`,
etc.) — you compose them into a board layout that matches your app's chrome.

```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { WorkflowsProvider } from '@atizar/react'
import { workflowsConfig } from './workflows.js'
import { Board } from './Board.js'    // your own board layout component

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <WorkflowsProvider config={workflowsConfig}>
      <Board />
    </WorkflowsProvider>
  </StrictMode>
)
```

> **`@atizar/react` does NOT export a turnkey `BoardApp`** — you own the chrome. Import the
> primitives you need (`PipelineColumn`, `AgentCard`, `AgentModal`, `WorkflowSwitcher`, …) and
> compose them. The demo app's `apps/inbox/client/src/BoardApp/` is a working reference if you
> need a starting point.

---

## Detection checklist (Stage 0b uses this)

| File | Existence check |
|---|---|
| `workflows/index.ts` | exports `workflowDescriptors` |
| `server/workflows.ts` | exports `workflowServers` |
| `client/src/workflows.ts` or `client/workflows.ts` | exports `workflowsConfig` |
| Server entry | imports `createServer` from `@atizar/server` |
| Client entry | imports `WorkflowsProvider` from `@atizar/react` |

Any of the top three missing → bootstrap all five (they are a unit; partial bootstrap is risky).
