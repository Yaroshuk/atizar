/**
 * Pure, network-free Gmail message helpers (merged from gmail-basic + gmail-viewer).
 * No googleapis, no fs, no process.env — only data in → data out (Buffer is fine).
 * This file is plain ESM (.mjs) so the MCP server can import it directly via Node.
 */

// ---------------------------------------------------------------------------
// parseLatestMessage
// ---------------------------------------------------------------------------

/**
 * Extract structured fields from a Gmail users.messages.get response
 * (format: 'full').
 *
 * @param {object} message  Raw Gmail API message object.
 * @returns {{ threadId: string, from: string, subject: string, body: string }}
 */
export function parseLatestMessage(message) {
  const { threadId, snippet, payload = {} } = message
  const { headers = [], body: payloadBody = {}, parts } = payload

  const getHeader = (name) => {
    const lower = name.toLowerCase()
    return headers.find((h) => h.name.toLowerCase() === lower)?.value ?? ''
  }

  const from = getHeader('from')
  const subject = getHeader('subject')

  // Find text/plain body — walk parts recursively (one additional level deep
  // handles the common multipart/mixed > multipart/alternative nesting).
  const findPlainPart = (partList) => {
    for (const part of partList) {
      if (part.mimeType === 'text/plain') return part
      if (Array.isArray(part.parts)) {
        const found = findPlainPart(part.parts)
        if (found) return found
      }
    }
    return null
  }

  let rawBody = null

  if (Array.isArray(parts)) {
    const plainPart = findPlainPart(parts)
    rawBody = plainPart?.body?.data ?? null
  } else if (payloadBody.data) {
    rawBody = payloadBody.data
  }

  let bodyText
  if (rawBody) {
    bodyText = Buffer.from(rawBody, 'base64url').toString('utf8').trimEnd()
  } else {
    bodyText = (snippet ?? '').trimEnd()
  }

  return { threadId, from, subject, body: bodyText }
}

// ---------------------------------------------------------------------------
// parseEmailMeta
// ---------------------------------------------------------------------------

/**
 * Extract EmailRef metadata from a Gmail users.messages.get response
 * (format: 'metadata', headers From/Subject/Date).
 *
 * @param {object} message  Raw Gmail API message object.
 * @returns {{ messageId: string, threadId: string, from: string, subject: string,
 *             date: string, snippet: string }}
 */
export function parseEmailMeta(message) {
  const { id, threadId, snippet = '', payload = {} } = message
  const headers = payload.headers ?? []
  const getHeader = (name) => {
    const lower = name.toLowerCase()
    return headers.find((h) => h.name.toLowerCase() === lower)?.value ?? ''
  }
  return {
    messageId: id,
    threadId,
    from: getHeader('from'),
    subject: getHeader('subject'),
    date: getHeader('date'),
    snippet: snippet.trim(),
  }
}

// ---------------------------------------------------------------------------
// errText
// ---------------------------------------------------------------------------

/**
 * Extract a human-readable error message from an unknown thrown value.
 * Pure helper — no I/O, no Node deps.
 *
 * @param {unknown} err
 * @returns {string}
 */
export function errText(err) {
  return err?.response?.data?.error?.message ?? err?.message ?? String(err)
}

// ---------------------------------------------------------------------------
// buildReplyRaw
// ---------------------------------------------------------------------------

/**
 * Build an RFC822 reply message and return it base64url-encoded,
 * ready for Gmail drafts.create `message.raw`.
 *
 * @param {{ to: string, subject: string, body: string, threadId: string }} params
 *   threadId is accepted for signature completeness but is NOT embedded in the
 *   MIME — pass it separately to drafts.create.
 * @returns {string}  base64url-encoded RFC822 message.
 */
export function buildReplyRaw({ to, subject, body }) {
  // Prefix subject with "Re: " unless it already starts with a well-formed "Re: "
  // (case-insensitive, space required).  A malformed "re:NoSpace" is NOT treated as
  // already-prefixed so it gets a proper "Re: " prepended.
  const rePrefix = /^re:\s/i
  const finalSubject = rePrefix.test(subject) ? subject : `Re: ${subject}`

  const CRLF = '\r\n'
  const message = [`To: ${to}`, `Subject: ${finalSubject}`, '', body].join(CRLF)

  return Buffer.from(message, 'utf8').toString('base64url')
}
