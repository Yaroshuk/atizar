// The current episode of a keyed instance = its runs with the highest episodeSeq. A keyed instance
// that fully receded and reactivated has a higher episodeSeq on the new run, so a prior episode's
// (done) runs are excluded — they do not resurrect in the open thread. Generic: no workflow / no
// input-vs-worker branch (an input agent's latest scan is simply its current episode).
export function currentEpisode<T extends { episodeSeq: number }>(runs: T[]): T[] {
  if (runs.length === 0) return []
  const max = runs.reduce((m, r) => Math.max(m, r.episodeSeq), 0)
  return runs.filter((r) => r.episodeSeq === max)
}
