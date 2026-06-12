// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { parseLatestMessage, parseEmailMeta, buildReplyRaw } from './format.mjs'

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function b64url(text: string): string {
  return Buffer.from(text, 'utf8').toString('base64url')
}

function makePart(mimeType: string, text: string) {
  return { mimeType, body: { data: b64url(text) } }
}

function makeMessage(overrides: any = {}): any {
  return {
    id: 'msg1',
    threadId: 'thread42',
    snippet: 'fallback snippet text',
    payload: {
      mimeType: 'text/plain',
      headers: [
        { name: 'From', value: 'Ivan <ivan@acme.ru>' },
        { name: 'Subject', value: 'Order: 10 units' },
      ],
      body: { data: b64url('Simple body text') },
    },
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// parseLatestMessage
// ---------------------------------------------------------------------------

describe('parseLatestMessage', () => {
  it('extracts threadId, from, subject, and body from a multipart message', () => {
    const message = makeMessage({
      payload: {
        mimeType: 'multipart/alternative',
        headers: [
          { name: 'From', value: 'Ivan <ivan@acme.ru>' },
          { name: 'Subject', value: 'Order: 10 units' },
        ],
        body: {},
        parts: [
          makePart('text/plain', 'Hello from plain text part'),
          makePart('text/html', '<p>Hello from HTML part</p>'),
        ],
      },
    })

    const result = parseLatestMessage(message)

    expect(result.threadId).toBe('thread42')
    expect(result.from).toBe('Ivan <ivan@acme.ru>')
    expect(result.subject).toBe('Order: 10 units')
    expect(result.body).toBe('Hello from plain text part')
  })

  it('decodes body from payload.body.data when no parts array', () => {
    const message = makeMessage()

    const result = parseLatestMessage(message)

    expect(result.threadId).toBe('thread42')
    expect(result.body).toBe('Simple body text')
  })

  it('returns empty string for from and subject when headers are absent', () => {
    const message = makeMessage({
      payload: {
        mimeType: 'text/plain',
        headers: [],
        body: { data: b64url('body') },
      },
    })

    const result = parseLatestMessage(message)

    expect(result.from).toBe('')
    expect(result.subject).toBe('')
  })

  it('matches header names case-insensitively', () => {
    const message = makeMessage({
      payload: {
        mimeType: 'text/plain',
        headers: [
          { name: 'from', value: 'alice@example.com' },
          { name: 'SUBJECT', value: 'Test case' },
        ],
        body: { data: b64url('body') },
      },
    })

    const result = parseLatestMessage(message)

    expect(result.from).toBe('alice@example.com')
    expect(result.subject).toBe('Test case')
  })

  it('falls back to snippet when no decodable body is present', () => {
    const message = makeMessage({
      payload: {
        mimeType: 'text/plain',
        headers: [],
        body: {},
      },
    })

    const result = parseLatestMessage(message)

    expect(result.body).toBe('fallback snippet text')
  })

  it('trims trailing whitespace from body', () => {
    const message = makeMessage({
      payload: {
        mimeType: 'text/plain',
        headers: [],
        body: { data: b64url('body text   \n\n') },
      },
    })

    const result = parseLatestMessage(message)

    expect(result.body).toBe('body text')
  })

  it('finds text/plain part in nested parts (one level deep)', () => {
    const message = makeMessage({
      payload: {
        mimeType: 'multipart/mixed',
        headers: [{ name: 'From', value: 'bob@example.com' }],
        body: {},
        parts: [
          {
            mimeType: 'multipart/alternative',
            body: {},
            parts: [
              makePart('text/plain', 'Nested plain text'),
              makePart('text/html', '<p>Nested HTML</p>'),
            ],
          },
        ],
      },
    })

    const result = parseLatestMessage(message)

    expect(result.body).toBe('Nested plain text')
  })

  it('does not throw when payload is missing; falls back to snippet', () => {
    // Real Gmail edge case: metadata-format messages and some drafts omit payload.
    const result = parseLatestMessage({ threadId: 't1', snippet: 'just a preview' })

    expect(result).toEqual({ threadId: 't1', from: '', subject: '', body: 'just a preview' })
  })

  it('does not throw when payload and snippet are both missing; body is empty string', () => {
    const result = parseLatestMessage({ threadId: 't1' })

    expect(result).toEqual({ threadId: 't1', from: '', subject: '', body: '' })
  })
})

// ---------------------------------------------------------------------------
// parseEmailMeta
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// buildReplyRaw
// ---------------------------------------------------------------------------

describe('buildReplyRaw', () => {
  function decode(raw: string): string {
    return Buffer.from(raw, 'base64url').toString('utf8')
  }

  it('builds a properly structured reply email', () => {
    const raw = buildReplyRaw({
      to: 'ivan@acme.ru',
      subject: 'Order: 10 units',
      body: 'Thank you for your order.',
      threadId: 'thread42',
    })

    const decoded = decode(raw)

    expect(decoded).toContain('To: ivan@acme.ru')
    expect(decoded).toContain('Subject: Re: Order: 10 units')
    expect(decoded).toContain('Thank you for your order.')
  })

  it('uses CRLF line endings', () => {
    const raw = buildReplyRaw({
      to: 'ivan@acme.ru',
      subject: 'Hello',
      body: 'Hi there.',
      threadId: 'thread1',
    })

    const decoded = decode(raw)

    expect(decoded).toContain('\r\n')
  })

  it('does not double-prefix subject already starting with Re:', () => {
    const raw = buildReplyRaw({
      to: 'ivan@acme.ru',
      subject: 'Re: Order: 10 units',
      body: 'Got it.',
      threadId: 'thread42',
    })

    const decoded = decode(raw)

    expect(decoded).toContain('Subject: Re: Order: 10 units')
    expect(decoded).not.toContain('Subject: Re: Re:')
  })

  it('prepends Re: to a malformed subject with no space after the colon', () => {
    // "re:Already replied" has no space after the colon — it is NOT treated as
    // already-prefixed (regex requires /^re:\s/i), so a proper "Re: " is added.
    const raw = buildReplyRaw({
      to: 'ivan@acme.ru',
      subject: 're:Already replied',
      body: 'Following up.',
      threadId: 'thread99',
    })

    const decoded = decode(raw)

    expect(decoded).toContain('Subject: Re: re:Already replied')
  })

  it('returns a valid base64url string (no standard base64 characters +/=)', () => {
    const raw = buildReplyRaw({
      to: 'test@example.com',
      subject: 'Test',
      body: 'Body.',
      threadId: 'thread1',
    })

    // base64url uses - and _ instead of + and /, no padding =
    expect(raw).not.toMatch(/[+/=]/)
  })

  it('includes a blank line separating headers from body', () => {
    const raw = buildReplyRaw({
      to: 'ivan@acme.ru',
      subject: 'Hi',
      body: 'Body content here.',
      threadId: 'thread1',
    })

    const decoded = decode(raw)

    // RFC822: blank line (CRLF CRLF) separates headers from body
    expect(decoded).toContain('\r\n\r\n')
    const bodyStart = decoded.indexOf('\r\n\r\n')
    expect(decoded.slice(bodyStart + 4)).toContain('Body content here.')
  })
})
