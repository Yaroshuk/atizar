import type { BaseEvent } from '@ag-ui/client'

// A cassette file is JSONL: one recorded AG-UI event per line, tagged with its
// step. Step = how many human approvals are already behind us (see
// resolvedApprovalCount). All of one agent's steps live in ONE file.

export function encodeLine(step: number, event: BaseEvent): string {
  return JSON.stringify({ step, event })
}

export function parseLine(line: string): { step: number; event: BaseEvent } | null {
  const trimmed = line.trim()
  if (!trimmed) return null
  try {
    const obj = JSON.parse(trimmed) as { step?: unknown; event?: unknown }
    if (typeof obj.step === 'number' && obj.event) {
      return { step: obj.step, event: obj.event as BaseEvent }
    }
  } catch {
    // not a cassette line
  }
  return null
}

export function eventsForStep(text: string, step: number): BaseEvent[] {
  const out: BaseEvent[] = []
  for (const line of text.split('\n')) {
    const parsed = parseLine(line)
    if (parsed && parsed.step === step) out.push(parsed.event)
  }
  return out
}

// Keep every valid line whose step differs (drops blank/invalid lines too).
export function dropStep(text: string, step: number): string {
  return text
    .split('\n')
    .filter((line) => {
      const parsed = parseLine(line)
      return parsed !== null && parsed.step !== step
    })
    .join('\n')
}
