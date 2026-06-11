import { leadInbox } from '../workflows/lead-inbox/descriptor.js'
import { githubTriage } from '../workflows/github-triage/descriptor.js'
import { emailInbox } from '../workflows/email-inbox/descriptor.js'
import { leadInboxServer } from '../workflows/lead-inbox/server.js'
import { githubTriageServer } from '../workflows/github-triage/server.js'
import { emailInboxServer } from '../workflows/email-inbox/server.js'
import type { ServerBinding } from '../workflows/server-binding.js'
import type { WorkflowDescriptor } from '@platform/core'

export type WorkflowServer = {
  descriptor: WorkflowDescriptor
  bindings: (origin: string) => ServerBinding[]
}

// Add a workflow = add one entry here.
export const workflowServers: WorkflowServer[] = [
  { descriptor: leadInbox, bindings: leadInboxServer },
  { descriptor: githubTriage, bindings: githubTriageServer },
  { descriptor: emailInbox, bindings: emailInboxServer },
]
