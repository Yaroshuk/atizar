import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { Connections } from './Connections.js'

// A Response-like stub for our fetch mock (only the bits the hook/component read).
const jsonResponse = (body: unknown) => ({ ok: true, json: async () => body })

const fakeConnections = [
  {
    integration: 'gmail',
    connection: 'default',
    provider: 'google',
    connected: true,
    detail: 'test@example.com',
  },
  { integration: 'slack', connection: 'default', provider: 'google', connected: false },
]

afterEach(() => {
  vi.restoreAllMocks()
})

describe('Connections', () => {
  it('shows the detail for a connected row', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(jsonResponse(fakeConnections) as Response)
    render(<Connections />)
    await waitFor(() => expect(screen.getByText(/test@example\.com/)).toBeInTheDocument())
  })

  it('shows a Connect link with the right href for a not-connected row', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(jsonResponse(fakeConnections) as Response)
    render(<Connections />)
    const link = await screen.findByRole('link', { name: /connect/i })
    expect(link.getAttribute('href')).toContain('/api/connect/google?integration=slack')
  })

  it('disconnects then refetches when Disconnect is clicked', async () => {
    const fetchMock = vi
      .spyOn(global, 'fetch')
      // initial GET
      .mockResolvedValueOnce(jsonResponse(fakeConnections) as Response)
      // DELETE
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) } as Response)
      // refetch GET
      .mockResolvedValueOnce(jsonResponse(fakeConnections) as Response)

    render(<Connections />)
    const disconnect = await screen.findByRole('button', { name: /disconnect/i })
    fireEvent.click(disconnect)

    await waitFor(() => {
      const deleteCall = fetchMock.mock.calls.find((c) => c[1]?.method === 'DELETE')
      expect(deleteCall).toBeTruthy()
      expect(String(deleteCall?.[0])).toContain('/api/connections/gmail')
    })
    // a refetch GET fired after the DELETE
    await waitFor(() => {
      const getCalls = fetchMock.mock.calls.filter((c) => c[0] === '/api/connections')
      expect(getCalls.length).toBeGreaterThanOrEqual(2)
    })
  })
})
