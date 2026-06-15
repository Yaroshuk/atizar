import type { WorkflowDescriptor } from '@atizar/core'
import { emailInbox } from './email-inbox/descriptor.js'

// Add a workflow = import its descriptor and add it here. Nothing else in this file.
export const workflowDescriptors: WorkflowDescriptor[] = [emailInbox]
