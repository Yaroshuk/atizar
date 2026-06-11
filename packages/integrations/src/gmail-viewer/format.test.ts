// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { parseEmailMeta } from './format.mjs'

describe('parseEmailMeta', () => {
  it('extracts metadata fields from a metadata-format message', () => {
    const message = {
      id: 'm1',
      threadId: 't1',
      snippet: '  Quick question about pricing ',
      payload: {
        headers: [
          { name: 'From', value: 'lead@example.com' },
          { name: 'Subject', value: 'Pricing' },
          { name: 'Date', value: 'Wed, 11 Jun 2026 09:00:00 +0200' },
        ],
      },
    }
    expect(parseEmailMeta(message)).toEqual({
      messageId: 'm1',
      threadId: 't1',
      from: 'lead@example.com',
      subject: 'Pricing',
      date: 'Wed, 11 Jun 2026 09:00:00 +0200',
      snippet: 'Quick question about pricing',
    })
  })

  it('returns empty strings for missing headers and snippet', () => {
    expect(parseEmailMeta({ id: 'm2', threadId: 't2', payload: {} })).toEqual({
      messageId: 'm2',
      threadId: 't2',
      from: '',
      subject: '',
      date: '',
      snippet: '',
    })
  })
})
