// Per-agent concurrency cap + FIFO overflow queue. The cap predicate (`active < cap`) is
// ported from the unit-tested client logic in `client/src/instancesCore.ts` (canSpawn);
// here it runs server-side over a live count instead of the instance array.
//
// The pool kicks off `run(id)` (the RunObserver) and never awaits it — the observer calls
// `release(agentId)` when its run terminates OR suspends at a gate (the claude-cli process
// is killed at the approval point, so the slot frees). `resumeAcquire` re-takes a slot for
// a continuing run AHEAD of the queue (continuing work has priority over new dispatches).

interface AgentSlot {
  active: number
  cap: number
  queue: string[]
}

export interface WorkerPool {
  enqueue(id: string, agentId: string, cap: number): void
  release(agentId: string): void
  resumeAcquire(id: string, agentId: string): void
  activeCount(agentId: string): number
  queuedCount(agentId: string): number
}

export function makeWorkerPool(opts: { run: (id: string) => void }): WorkerPool {
  const slots = new Map<string, AgentSlot>()

  const slot = (agentId: string, cap: number): AgentSlot => {
    let s = slots.get(agentId)
    if (!s) {
      s = { active: 0, cap, queue: [] }
      slots.set(agentId, s)
    }
    s.cap = cap // latest dispatch's cap wins (the passport's maxInstances is stable anyway)
    return s
  }

  const start = (id: string, s: AgentSlot): void => {
    s.active++
    opts.run(id)
  }

  return {
    enqueue(id, agentId, cap) {
      const s = slot(agentId, cap)
      if (s.active < s.cap) start(id, s)
      else s.queue.push(id)
    },

    release(agentId) {
      const s = slots.get(agentId)
      if (!s) return
      s.active = Math.max(0, s.active - 1)
      const next = s.queue.shift()
      if (next !== undefined) start(next, s)
    },

    // Continuing a suspended run: re-take a slot immediately, bypassing the queue. May
    // briefly exceed the cap (acceptable — the work was already admitted).
    resumeAcquire(id, agentId) {
      const s = slots.get(agentId) ?? slot(agentId, 1)
      start(id, s)
    },

    activeCount(agentId) {
      return slots.get(agentId)?.active ?? 0
    },

    queuedCount(agentId) {
      return slots.get(agentId)?.queue.length ?? 0
    },
  }
}
