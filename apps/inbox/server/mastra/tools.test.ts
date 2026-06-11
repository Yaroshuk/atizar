// @vitest-environment node
import { describe, it, expect } from 'vitest'
import {
  listUnreadTool,
  getEmailTool,
  routeEmailsTool,
  renderSortTool,
  applyActionsTool,
} from './tools.js'

// Mastra types inputSchema as a StandardSchema and execute as a 2-arg fn; for the test we read the
// underlying zod schema + call execute with just the validated input (the shape the tool sees).
const tool = (t: unknown) => t as { id: string; inputSchema: any; execute: (input: any) => any }

describe('email-inbox Mastra tools', () => {
  it('read tools carry the right ids + input schemas', () => {
    expect(tool(listUnreadTool).id).toBe('list_unread')
    expect(tool(getEmailTool).id).toBe('get_email')
    // get_email requires a messageId; list_unread's sinceHours is optional.
    expect(tool(getEmailTool).inputSchema.safeParse({ messageId: 'm1' }).success).toBe(true)
    expect(tool(getEmailTool).inputSchema.safeParse({}).success).toBe(false)
    expect(tool(listUnreadTool).inputSchema.safeParse({}).success).toBe(true)
  })

  it('capture tools echo their validated input (no side effect)', async () => {
    expect(tool(routeEmailsTool).id).toBe('route_emails')
    expect(tool(renderSortTool).id).toBe('renderSort')
    expect(tool(applyActionsTool).id).toBe('applyActions')

    const routeArgs = { to: 'reader', emails: [{ messageId: 'm1' }] }
    expect(await tool(routeEmailsTool).execute(routeArgs)).toEqual(routeArgs)

    const applyArgs = { items: [{ messageId: 'm1', action: 'read' }] }
    expect(await tool(applyActionsTool).execute(applyArgs)).toEqual(applyArgs)

    const sortArgs = { summary: 's', counts: { reader: 1 } }
    expect(await tool(renderSortTool).execute(sortArgs)).toEqual(sortArgs)
  })

  it('applyActions input schema validates the per-row action enum', () => {
    expect(
      tool(applyActionsTool).inputSchema.safeParse({ items: [{ messageId: 'm', action: 'trash' }] })
        .success
    ).toBe(true)
    expect(
      tool(applyActionsTool).inputSchema.safeParse({ items: [{ messageId: 'm', action: 'bogus' }] })
        .success
    ).toBe(false)
  })
})
