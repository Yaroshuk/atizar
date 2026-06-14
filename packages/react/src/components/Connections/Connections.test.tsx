import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { Connections } from './Connections.js'
import { WorkflowsProvider } from '../../workflowsContext.js'

// Minimal config — Connections only reads authToken; other fields unused in these tests.
const cfg = { workflows: [], meta: {}, renders: [], hitl: [] }
const withProvider = (ui: React.ReactElement) => (
  <WorkflowsProvider config={cfg}>{ui}</WorkflowsProvider>
)

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
  it('is collapsed by default: a toggle button, no chip rows, warn title when any disconnected', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(jsonResponse(fakeConnections) as Response)
    render(withProvider(<Connections />))

    // The single compact trigger is present.
    const button = await screen.findByRole('button', { name: /connections/i })
    // One row in the list is not connected → the trigger flags "Action needed".
    expect(button).toHaveAttribute('title', 'Action needed')
    // Collapsed: the chip rows (which show the integration name) are not rendered yet.
    expect(screen.queryByText('gmail')).not.toBeInTheDocument()
    expect(screen.queryByText('slack')).not.toBeInTheDocument()
  })

  it('opens the popover with the chip rows when the trigger is clicked', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(jsonResponse(fakeConnections) as Response)
    render(withProvider(<Connections />))

    const button = await screen.findByRole('button', { name: /connections/i })
    fireEvent.click(button)

    await waitFor(() => expect(screen.getByText('slack')).toBeInTheDocument())
    expect(screen.getByText(/test@example\.com/)).toBeInTheDocument()
    const link = screen.getByRole('link', { name: /connect/i })
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

    render(withProvider(<Connections />))
    // Open the popover first — the Disconnect action lives inside it now.
    const trigger = await screen.findByRole('button', { name: /connections/i })
    fireEvent.click(trigger)
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
