import { emailInbox } from '../workflows/email-inbox/descriptor.js'
import { emailInboxServer } from '../workflows/email-inbox/server.js'
import type { ServerBinding } from '../workflows/server-binding.js'
import type { WorkflowDescriptor } from '@atizar/core'

export type WorkflowServer = {
  descriptor: WorkflowDescriptor
  bindings: (origin: string) => ServerBinding[]
}

// Add a workflow = add one entry here.
export const workflowServers: WorkflowServer[] = [
  { descriptor: emailInbox, bindings: emailInboxServer },
]
