import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TextEncoder, TextDecoder } from 'util'
import ScreenRouter from '@/components/ScreenRouter'
import { useLeftPanelStore } from '@/lib/stores/left-panel-store'
import { useEventsStore } from '@/lib/stores/events-store'
import type { CalendarEvent } from '@/types'

// jsdom doesn't always provide the Web encoders the SSE reader relies on.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
if (!global.TextEncoder) (global as any).TextEncoder = TextEncoder
// eslint-disable-next-line @typescript-eslint/no-explicit-any
if (!global.TextDecoder) (global as any).TextDecoder = TextDecoder

// ─── fetch + SSE mocking ────────────────────────────────────────────────────
const fetchMock = jest.fn()
beforeEach(() => {
  fetchMock.mockReset()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(global as any).fetch = fetchMock
  // The stores are module-level singletons; reset both between tests so state
  // never leaks from one case to the next.
  useLeftPanelStore.getState().reset()
  useEventsStore.getState().reset()
})

const enc = (s: string) => new TextEncoder().encode(s)

/**
 * Build a minimal Response-like object whose `body.getReader()` streams the given
 * raw SSE frame strings, one per read. `hang: true` leaves the stream open after
 * the frames (a read that never resolves) to simulate an in-flight stream.
 */
function sseResponse(
  frames: string[],
  opts: { ok?: boolean; contentType?: string; hang?: boolean; body?: boolean } = {},
) {
  const {
    ok = true,
    contentType = 'text/event-stream; charset=utf-8',
    hang = false,
    body = true,
  } = opts
  let i = 0
  const reader = {
    read: () => {
      if (i < frames.length) return Promise.resolve({ done: false, value: enc(frames[i++]) })
      if (hang) return new Promise(() => {}) // never resolves — stream stays open
      return Promise.resolve({ done: true, value: undefined })
    },
    cancel: () => Promise.resolve(),
  }
  return {
    ok,
    headers: { get: (h: string) => (h.toLowerCase() === 'content-type' ? contentType : null) },
    body: body ? { getReader: () => reader } : null,
  }
}

const statusFrame = (stage: string) => `event: status\ndata: ${JSON.stringify({ stage })}\n\n`
const deltaFrame = (text: string) => `event: delta\ndata: ${JSON.stringify({ text })}\n\n`
const doneFrame = (summary: string, events: unknown) =>
  `event: done\ndata: ${JSON.stringify({ summary, events })}\n\n`
const errorFrame = (message: string) => `event: error\ndata: ${JSON.stringify({ message })}\n\n`

const EVENT: CalendarEvent = {
  id: 1,
  title: 'Sports Day',
  date: 'Thursday, 26 June 2025',
  time: '9:30 AM',
  location: 'Playing Fields',
  notes: null,
  cal: '20250626T093000/20250626T103000',
  confidence: { title: 'high', datetime: 'high', location: 'high' },
}

// Drive the real upload flow: put a PDF into the hidden file input, which the
// UploadZone validates (by MIME) and forwards to ScreenRouter.handleFileReady.
async function uploadPdf(container: HTMLElement) {
  const input = container.querySelector('input[type="file"]') as HTMLInputElement
  const file = new File(['%PDF-1.3 test'], 'letter.pdf', { type: 'application/pdf' })
  await userEvent.setup().upload(input, file)
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('ScreenRouter — two-panel workspace streaming', () => {
  it('streams the summary into the left panel and the events into the right panel', async () => {
    fetchMock.mockResolvedValue(
      sseResponse([
        statusFrame('reading'),
        statusFrame('summarizing'),
        deltaFrame('Here is your summary.'),
        statusFrame('extracting'),
        doneFrame('Here is your summary.', [EVENT]),
        statusFrame('complete'),
      ]),
    )
    const { container } = render(<ScreenRouter />)
    await uploadPdf(container)

    // Left panel: the streamed summary is present.
    expect(await screen.findByText('Here is your summary.')).toBeInTheDocument()
    // Right panel: the existing events display rendered with the event.
    expect(await screen.findByText('Found 1 event')).toBeInTheDocument()
    expect(screen.getByText('Sports Day')).toBeInTheDocument()
  })

  it('shows a changing agent-status line while the stream is open', async () => {
    // Emit a status + delta then hang (no `done`) — we should sit in the workspace
    // with the streamed text and a live status line visible.
    fetchMock.mockResolvedValue(
      sseResponse([statusFrame('summarizing'), deltaFrame('Reading in progress…')], { hang: true }),
    )
    const { container, unmount } = render(<ScreenRouter />)
    await uploadPdf(container)

    expect(await screen.findByText('Reading in progress…')).toBeInTheDocument()
    // The status line reflects the explicit `summarizing` stage.
    expect(await screen.findByText('Writing summary…')).toBeInTheDocument()
    // Not yet on a finished result.
    expect(screen.queryByText(/^Found/)).not.toBeInTheDocument()

    unmount() // triggers the unmount-abort cleanup for the still-open stream
  })
})

describe('ScreenRouter — panel-scoped errors', () => {
  it('an events-only failure shows on the right while the summary survives on the left', async () => {
    // A terminal frame whose `events` is not an array: the summary is fine, so the
    // left panel keeps it; only the right panel shows an error. Proves independence.
    fetchMock.mockResolvedValue(
      sseResponse([deltaFrame('A good summary.'), doneFrame('A good summary.', 'not-an-array')]),
    )
    const { container } = render(<ScreenRouter />)
    await uploadPdf(container)

    // Right panel errored…
    expect(await screen.findByText(/couldn.t list the events/i)).toBeInTheDocument()
    // …but the left panel's streamed summary is untouched.
    expect(screen.getByText('A good summary.')).toBeInTheDocument()
  })

  it('a non-SSE (rejected) response fails both panels independently', async () => {
    fetchMock.mockResolvedValue(
      sseResponse([], { ok: false, contentType: 'application/json', body: false }),
    )
    const { container } = render(<ScreenRouter />)
    await uploadPdf(container)

    expect(await screen.findByText(/couldn.t read that one/i)).toBeInTheDocument()
    expect(screen.getByText(/couldn.t list the events/i)).toBeInTheDocument()
  })

  it('a malformed data frame fails both panels', async () => {
    fetchMock.mockResolvedValue(sseResponse(['event: delta\ndata: {not valid json\n\n']))
    const { container } = render(<ScreenRouter />)
    await uploadPdf(container)

    expect(await screen.findByText(/couldn.t read that one/i)).toBeInTheDocument()
  })

  it('a stream that ends without a done frame (dropped) fails both panels', async () => {
    fetchMock.mockResolvedValue(sseResponse([deltaFrame('partial…')]))
    const { container } = render(<ScreenRouter />)
    await uploadPdf(container)

    expect(await screen.findByText(/couldn.t read that one/i)).toBeInTheDocument()
  })

  it('surfaces a server-sent in-band error frame on both panels', async () => {
    fetchMock.mockResolvedValue(sseResponse([errorFrame('Extraction failed. Please try again.')]))
    const { container } = render(<ScreenRouter />)
    await uploadPdf(container)

    expect(await screen.findByText(/couldn.t read that one/i)).toBeInTheDocument()
  })

  it('treats an aborted fetch as normal — no error is shown', async () => {
    fetchMock.mockRejectedValue(Object.assign(new Error('aborted'), { name: 'AbortError' }))
    const { container } = render(<ScreenRouter />)
    await uploadPdf(container)

    // The AbortError is swallowed; we stay in the workspace with no error surfaced.
    await new Promise((r) => setTimeout(r, 50))
    expect(screen.queryByText(/couldn.t read that one/i)).not.toBeInTheDocument()
  })
})
