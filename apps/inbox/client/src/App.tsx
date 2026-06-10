import { InboxView } from './InboxView'

// The UI is fully server-driven (step 6): InboxView reads the board over HTTP+SSE and acts
// via plain HTTP. No CopilotKit provider tree anymore.
export const App = () => <InboxView />
