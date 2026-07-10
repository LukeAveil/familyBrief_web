import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TextEncoder, TextDecoder } from 'util'
import ScreenRouter from '@/components/ScreenRouter'
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

const deltaFrame = (text: string) => `event: delta\ndata: ${JSON.stringify({ text })}\n\n`
const doneFrame = (summary: string, events: CalendarEvent[]) =>
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

const errorHeading = () => screen.queryByText(/read that one/i)

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('ScreenRouter — streaming', () => {
  it('renders the summary live and lands on results with events', async () => {
    fetchMock.mockResolvedValue(
      sseResponse([deltaFrame('Here is your summary.'), doneFrame('Here is your summary.', [EVENT])]),
    )
    const { container } = render(<ScreenRouter />)
    await uploadPdf(container)

    expect(await screen.findByText('Found 1 event')).toBeInTheDocument()
    // The finished summary carries over onto the results screen.
    expect(screen.getByText('Here is your summary.')).toBeInTheDocument()
  })

  it('types the summary out on the processing screen while the stream is open', async () => {
    // Stream a delta then hang (no `done` yet) — we should sit on processing with
    // the streamed text visible, and definitely not on results or error.
    fetchMock.mockResolvedValue(sseResponse([deltaFrame('Reading in progress…')], { hang: true }))
    const { container, unmount } = render(<ScreenRouter />)
    await uploadPdf(container)

    expect(await screen.findByText('Reading your letter')).toBeInTheDocument()
    expect(await screen.findByText('Reading in progress…')).toBeInTheDocument()
    expect(screen.queryByText(/^Found/)).not.toBeInTheDocument()
    expect(errorHeading()).not.toBeInTheDocument()

    unmount() // triggers the unmount-abort cleanup for the still-open stream
  })
})

describe('ScreenRouter — error handling', () => {
  it('error case 1 — a non-SSE response (failed request) shows a recoverable error', async () => {
    fetchMock.mockResolvedValue(
      sseResponse([], { ok: false, contentType: 'application/json', body: false }),
    )
    const { container } = render(<ScreenRouter />)
    await uploadPdf(container)

    expect(await errorHeadingFound()).toBeInTheDocument()
  })

  it('error case 2 — a malformed data frame shows a recoverable error', async () => {
    fetchMock.mockResolvedValue(sseResponse(['event: delta\ndata: {not valid json\n\n']))
    const { container } = render(<ScreenRouter />)
    await uploadPdf(container)

    expect(await errorHeadingFound()).toBeInTheDocument()
  })

  it('error case 3 — a stream that ends without a done frame (dropped) errors', async () => {
    fetchMock.mockResolvedValue(sseResponse([deltaFrame('partial…')]))
    const { container } = render(<ScreenRouter />)
    await uploadPdf(container)

    expect(await errorHeadingFound()).toBeInTheDocument()
  })

  it('surfaces a server-sent in-band error frame as a recoverable error', async () => {
    fetchMock.mockResolvedValue(sseResponse([errorFrame('Extraction failed. Please try again.')]))
    const { container } = render(<ScreenRouter />)
    await uploadPdf(container)

    expect(await errorHeadingFound()).toBeInTheDocument()
  })

  it('treats an aborted fetch as normal — stays on processing, no error screen', async () => {
    fetchMock.mockRejectedValue(Object.assign(new Error('aborted'), { name: 'AbortError' }))
    const { container } = render(<ScreenRouter />)
    await uploadPdf(container)

    // handleFileReady navigates to processing before awaiting fetch; the AbortError
    // is swallowed, so we remain on processing and never show the error screen.
    expect(await screen.findByText('Reading your letter')).toBeInTheDocument()
    await new Promise(r => setTimeout(r, 50))
    expect(errorHeading()).not.toBeInTheDocument()
  })
})

// findBy helper for the error screen heading (apostrophe-safe regex).
function errorHeadingFound() {
  return screen.findByText(/read that one/i)
}
