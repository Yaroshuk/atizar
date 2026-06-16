import { describe, it, expect } from 'vitest'
import { STATUSES, STATUS_LABEL } from './status'

describe('status vocabulary', () => {
  it('labels every Status', () => {
    for (const s of STATUSES) expect(STATUS_LABEL[s]).toBeTruthy()
  })
})
