import type { WorkflowDescriptor } from '@platform/core'
import { leadInbox } from './lead-inbox/descriptor.js'
import { githubTriage } from './github-triage/descriptor.js'
import { emailInbox } from './email-inbox/descriptor.js'

// Add a workflow = import its descriptor and add it here. Nothing else in this file.
export const workflowDescriptors: WorkflowDescriptor[] = [leadInbox, githubTriage, emailInbox]
