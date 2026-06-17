import { describe, it, expect } from 'vitest'
// Cheap deterministic acceptance for the episode-scoping feature (pairs with the browser test
// e2e/episode-scoping.spec.ts).
import { currentEpisode } from './currentEpisode'

// A reply instance accumulates one Run per "episode" (a fresh email it drafts for the same sender),
// tagged by an increasing episodeSeq. currentEpisode() projects an instance's runs to ONLY the
// latest episode, so a prior already-approved (done) draft is never shown next to the new one.
describe('currentEpisode', () => {
  it('keeps only the runs of the highest episodeSeq', () => {
    const runs = [
      { id: 'r1', episodeSeq: 1, status: 'done' },
      { id: 'r2', episodeSeq: 2, status: 'awaiting_approval' },
    ]
    expect(currentEpisode(runs).map((r: { id: string }) => r.id)).toEqual(['r2'])
  })

  it('returns a single run unchanged (one episode)', () => {
    const runs = [{ id: 'only', episodeSeq: 1, status: 'awaiting_approval' }]
    expect(currentEpisode(runs).map((r: { id: string }) => r.id)).toEqual(['only'])
  })
})
