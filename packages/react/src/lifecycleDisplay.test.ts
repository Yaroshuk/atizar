import { describe, it, expect } from 'vitest'
import { OUTCOME_LABEL, OUTCOME_TINT, displayStatus } from './lifecycleDisplay'

describe('lifecycleDisplay', () => {
  it('labels every terminal outcome', () => {
    expect(OUTCOME_LABEL.done).toBe('Done')
    expect(OUTCOME_LABEL.stopped).toBe('Stopped')
    expect(OUTCOME_LABEL.rejected).toBe('Rejected')
    expect(OUTCOME_LABEL.error).toBe('Error')
  })

  it('tints stopped/rejected distinctly from done', () => {
    expect(OUTCOME_TINT.stopped).not.toBe(OUTCOME_TINT.done)
    expect(OUTCOME_TINT.rejected).not.toBe(OUTCOME_TINT.done)
  })

  it('maps phase+outcome to the display Status union', () => {
    expect(displayStatus('queued', 'running')).toBe('running')
    expect(displayStatus('active', 'running')).toBe('running')
    expect(displayStatus('awaiting_human', 'running')).toBe('awaiting_approval')
    expect(displayStatus('terminal', 'done')).toBe('done')
    expect(displayStatus('terminal', 'stopped')).toBe('done') // stopped renders in the done lane, labelled Stopped
    expect(displayStatus('terminal', 'error')).toBe('error')
  })
})
