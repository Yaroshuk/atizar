/**
 * Pure, network-free helpers for gmail-viewer.
 * No googleapis, no fs, no process.env — data in → data out.
 */

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
