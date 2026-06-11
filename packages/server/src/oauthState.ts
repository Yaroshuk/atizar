import { createHmac } from 'node:crypto'

export function signState(payload: Record<string, string>, key: string): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const sig = createHmac('sha256', key).update(body).digest('base64url')
  return `${body}.${sig}`
}

export function verifyState(state: string, key: string): Record<string, string> | null {
  const [body, sig] = state.split('.')
  if (!body || !sig) return null
  const expected = createHmac('sha256', key).update(body).digest('base64url')
  if (sig !== expected) return null
  try {
    return JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
  } catch {
    return null
  }
}
