import { z } from 'zod'

// The dispatch payload shapes (= the route_emails tool args minus `to`). EmailRef mirrors the
// email metadata shape; defined here as the workflow's own contract (userland), not imported
// from the integration's .d.ts (that is a type, not a runtime zod schema).
// messageId/threadId/from/subject are the fields the reply + batch prompts and cards actually
// consume, so they are REQUIRED and the route_emails MCP schema requires them too (a thin dispatch
// missing one surfaces as an MCP validation error, never a silent decodeHandoff→null no-op).
// date/snippet are passed through from list_unread but never consumed downstream → optional, so a
// dispatch that drops them still decodes.
//
// These live in their own module (not the descriptor) so prompts.ts can import them without
// importing the descriptor — which would close a descriptor↔prompts cycle.
export const EmailRefSchema = z.object({
  messageId: z.string(),
  threadId: z.string(),
  from: z.string(),
  subject: z.string(),
  date: z.string().optional(),
  snippet: z.string().optional(),
})
export type EmailRef = z.infer<typeof EmailRefSchema>

// A batch worker (reader/spam/important) receives a list of emails.
export const EmailBatchSchema = z.object({ emails: z.array(EmailRefSchema) })

// A reply worker receives ONE email (it fetches the body itself via get_email).
export const ReplyPayloadSchema = z.object({ email: EmailRefSchema })
