import { WorkflowBoard } from '@platform/react'
import { workflowsConfig } from './workflows'

// The UI is fully server-driven: WorkflowBoard (from @platform/react) reads the board over
// HTTP+SSE and acts via plain HTTP. The demo injects its workflow bundle (cards + specs) as
// config — the package imports no userland card.
export const App = () => <WorkflowBoard config={workflowsConfig} />
