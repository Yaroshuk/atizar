import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import React, { type ReactNode } from 'react'
import { WorkflowsProvider, type WorkflowsConfig } from '../workflowsContext.js'
import { useAcknowledge } from './useAcknowledge.js'

const cfg: WorkflowsConfig = { workflows: [], meta: {}, renders: [], hitl: [] }

const makeWrapper =
  (config: WorkflowsConfig) =>
  ({ children }: { children: ReactNode }) =>
    React.createElement(WorkflowsProvider, { config, children })

afterEach(() => {
  vi.restoreAllMocks()
})

describe('useAcknowledge', () => {
  it('POSTs the acknowledge endpoint for the work item id', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
      calls.push({ url, init })
      return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }))
    })
    const { result } = renderHook(() => useAcknowledge(), { wrapper: makeWrapper(cfg) })
    await result.current.acknowledge('wi-1')
    expect(calls[0].url).toBe('/api/workitems/wi-1/acknowledge')
    expect(calls[0].init?.method).toBe('POST')
  })

  it('sends the Authorization header when an authToken is configured', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
      calls.push({ url, init })
      return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }))
    })
    const { result } = renderHook(() => useAcknowledge(), {
      wrapper: makeWrapper({ ...cfg, authToken: 'tok-xyz' }),
    })
    await result.current.acknowledge('wi-2')
    expect((calls[0].init?.headers as Record<string, string>)['Authorization']).toBe(
      'Bearer tok-xyz'
    )
  })
})
