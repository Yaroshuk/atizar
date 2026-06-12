import { describe, it, expect, afterEach } from 'vitest'
import { emailInboxServer } from './server.js'

afterEach(() => delete process.env.DEMO)

describe('email-inbox effects in demo mode', () => {
  it('saveDraft returns a fake demo draftId without touching Gmail', async () => {
    process.env.DEMO = '1'
    const bindings = emailInboxServer()
    const reply = bindings.find((b) => b.effects?.saveDraft)
    const result = await reply!.effects!.saveDraft({ threadId: 't1', body: 'hi' }, {} as never)
    expect(result).toMatchObject({ ok: true })
    expect(String((result as { draftId?: string }).draftId)).toMatch(/^demo-/)
  })

  it('applyActions returns fake success counting the requested actions', async () => {
    process.env.DEMO = '1'
    const bindings = emailInboxServer()
    const batch = bindings.find((b) => b.effects?.applyActions)
    const result = await batch!.effects!.applyActions(
      { actions: [{ id: 'a', action: 'read' }, { id: 'b', action: 'read' }] },
      {} as never
    )
    expect(result).toMatchObject({ applied: 2, failed: [] })
  })
})
