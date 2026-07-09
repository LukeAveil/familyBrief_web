/**
 * @jest-environment node
 */

// Mock the Anthropic SDK so extract-events.ts never makes real API calls.
// The upload route now streams via messages.stream(), so we mock that.
const mockStream = jest.fn()

jest.mock('@anthropic-ai/sdk', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    messages: { stream: mockStream },
  })),
}))

import { NextRequest } from 'next/server'
import { POST } from '@/app/api/upload/route'
import { MAX_FILE_SIZE_BYTES } from '@/lib/file-config'
import { EVENTS_DELIMITER } from '@/lib/extract-events'

beforeEach(() => mockStream.mockReset())

// Provide a dummy API key so the env-var guard in getClient() doesn't throw.
// The Anthropic SDK itself is mocked above so no real key is needed.
process.env.ANTHROPIC_API_KEY = 'test-key'

// ─── Helpers ─────────────────────────────────────────────────────────────────

// The rate limiter is module-level state. To avoid tests interfering with each
// other, every test gets its own unique IP address via a simple counter.
let ipCounter = 0
const uniqueIp = () => `10.${Math.floor(ipCounter / 255)}.${ipCounter++ % 255}.1`

const makeRequest = (formData: FormData, ip = uniqueIp()) => {
  const headers: Record<string, string> = { 'x-forwarded-for': ip }
  return new NextRequest('http://localhost/api/upload', { method: 'POST', body: formData, headers })
}

const makeFormData = (file: File, fieldName = 'file') => {
  const fd = new FormData()
  fd.append(fieldName, file)
  return fd
}

// Magic byte prefixes for each supported type
const PDF_MAGIC = new Uint8Array([0x25, 0x50, 0x44, 0x46]) // %PDF
const JPEG_MAGIC = new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0])

function makeFile(name: string, type: string, sizeBytes = 100, magic?: Uint8Array): File {
  const buf = new ArrayBuffer(Math.max(sizeBytes, magic?.length ?? 0))
  const content = new Uint8Array(buf)
  if (magic) content.set(magic, 0)
  return new File([buf], name, { type })
}

function makePdf(name = 'letter.pdf', sizeBytes = 100) {
  return makeFile(name, 'application/pdf', sizeBytes, PDF_MAGIC)
}
function makeJpeg(name = 'photo.jpg', sizeBytes = 100) {
  return makeFile(name, 'image/jpeg', sizeBytes, JPEG_MAGIC)
}

const MOCK_EVENTS_JSON = JSON.stringify([{
  title: 'Sports Day',
  date: '2025-06-26',
  time: '09:30',
  endTime: '12:00',
  location: 'Playing Fields',
  description: 'Wear PE kit',
  category: 'school',
}])

// The model's full response: a summary, the delimiter, then the JSON array —
// the shape streamEventsFromFile splits on.
const MOCK_FULL_TEXT = `Here is a quick summary of what I found.\n${EVENTS_DELIMITER}\n${MOCK_EVENTS_JSON}`

// A fake MessageStream: async-iterable yielding text_delta events. Emitting the
// text in two chunks exercises the incremental delimiter-splitting logic.
function fakeStream(text: string) {
  return {
    async *[Symbol.asyncIterator]() {
      const mid = Math.floor(text.length / 2)
      yield { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: text.slice(0, mid) } }
      yield { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: text.slice(mid) } }
    },
  }
}

function mockSuccess(text = MOCK_FULL_TEXT) {
  mockStream.mockImplementationOnce(() => fakeStream(text))
}

// Read an SSE Response body to completion and return its parsed frames.
async function collectSSE(res: Response): Promise<{ event: string; data: string }[]> {
  const body = await res.text()
  return body
    .split('\n\n')
    .filter(Boolean)
    .map(raw => {
      let event = 'message'
      const data: string[] = []
      for (const line of raw.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim()
        else if (line.startsWith('data:')) data.push(line.slice(5).trimStart())
      }
      return { event, data: data.join('\n') }
    })
}

// ─── Validation tests ─────────────────────────────────────────────────────────

describe('POST /api/upload — validation', () => {
  it('returns 400 when no file is present', async () => {
    const res = await POST(makeRequest(new FormData()))
    expect(res.status).toBe(400)
    expect((await res.json()).ok).toBe(false)
  })

  it('returns 400 when the field name is wrong', async () => {
    const fd = makeFormData(makePdf(), 'document')
    const res = await POST(makeRequest(fd))
    expect(res.status).toBe(400)
    expect((await res.json()).ok).toBe(false)
  })

  it('returns 415 for an unsupported file type', async () => {
    const fd = makeFormData(makeFile('notes.txt', 'text/plain'))
    const res = await POST(makeRequest(fd))
    expect(res.status).toBe(415)
    const body = await res.json()
    expect(body.ok).toBe(false)
    expect(body.error).toBeTruthy()
  })

  it('returns 415 when magic bytes do not match the declared MIME type', async () => {
    // A file declaring itself as PDF but with wrong bytes (all zeros)
    const fd = makeFormData(makeFile('fake.pdf', 'application/pdf', 100))
    const res = await POST(makeRequest(fd))
    expect(res.status).toBe(415)
    const body = await res.json()
    expect(body.ok).toBe(false)
    expect(body.error).toBe('File content does not match its type')
  })

  it('returns 413 when the file exceeds the size limit', async () => {
    const fd = makeFormData(makePdf('big.pdf', MAX_FILE_SIZE_BYTES + 1))
    const res = await POST(makeRequest(fd))
    expect(res.status).toBe(413)
    expect((await res.json()).ok).toBe(false)
  })

  it('accepts a file exactly at the size limit', async () => {
    mockSuccess()
    const fd = makeFormData(makePdf('max.pdf', MAX_FILE_SIZE_BYTES))
    const res = await POST(makeRequest(fd))
    expect(res.status).toBe(200)
  })
})

// ─── Extraction tests ─────────────────────────────────────────────────────────

describe('POST /api/upload — extraction (SSE)', () => {
  it('streams a summary then a done frame with events for a valid PDF', async () => {
    mockSuccess()
    const fd = makeFormData(makePdf())
    const res = await POST(makeRequest(fd))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/event-stream')

    const frames = await collectSSE(res)
    // Summary streamed as one or more delta frames…
    const summary = frames.filter(f => f.event === 'delta').map(f => JSON.parse(f.data).text).join('')
    expect(summary).toContain('summary of what I found')
    // …and the terminal done frame carries the parsed events (never partial JSON).
    const done = frames.find(f => f.event === 'done')
    expect(done).toBeTruthy()
    const data = JSON.parse(done!.data)
    expect(Array.isArray(data.events)).toBe(true)
    expect(data.events.length).toBeGreaterThan(0)
    expect(typeof data.summary).toBe('string')
  })

  it('streams successfully for a valid JPEG', async () => {
    mockSuccess()
    const fd = makeFormData(makeJpeg())
    const res = await POST(makeRequest(fd))
    expect(res.status).toBe(200)
    const frames = await collectSSE(res)
    expect(frames.some(f => f.event === 'done')).toBe(true)
  })

  it('emits an in-band, sanitized error frame when the Anthropic stream throws', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {})
    mockStream.mockImplementationOnce(() => ({
      async *[Symbol.asyncIterator]() { throw new Error('rate limited') },
    }))
    const fd = makeFormData(makePdf())
    const res = await POST(makeRequest(fd))
    // Headers are already committed to 200 — the error is delivered in-band.
    expect(res.status).toBe(200)
    const frames = await collectSSE(res)
    const errFrame = frames.find(f => f.event === 'error')
    expect(errFrame).toBeTruthy()
    expect(JSON.parse(errFrame!.data).message).toBe('Extraction failed. Please try again.')
    // The raw SDK error text must never leak to the client.
    expect(errFrame!.data).not.toContain('rate limited')
    ;(console.error as jest.Mock).mockRestore()
  })

  it('each streamed event has the expected CalendarEvent shape', async () => {
    mockSuccess()
    const fd = makeFormData(makePdf())
    const frames = await collectSSE(await POST(makeRequest(fd)))
    const { events } = JSON.parse(frames.find(f => f.event === 'done')!.data)
    const [event] = events
    expect(typeof event.id).toBe('number')
    expect(typeof event.title).toBe('string')
    expect(typeof event.date).toBe('string')
    expect(typeof event.cal).toBe('string')
    // Per-field confidence: title and datetime always present, each a valid level.
    expect(['high', 'medium', 'low']).toContain(event.confidence.title)
    expect(['high', 'medium', 'low']).toContain(event.confidence.datetime)
  })
})

// ─── Rate limiting tests ──────────────────────────────────────────────────────

describe('POST /api/upload — rate limiting', () => {
  // The rate limiter is module-level state (a Map keyed by IP). Since we cannot
  // reset it without jest.resetModules(), we use freshly allocated IPs for each
  // test case so there is no cross-test state contamination.

  it('returns 200 for requests within the limit', async () => {
    const ip = uniqueIp()
    // The request gets past the rate limiter but fails at MIME check (415 — not 429).
    const fd = makeFormData(makeFile('notes.txt', 'text/plain'))
    const res = await POST(makeRequest(fd, ip))
    expect(res.status).not.toBe(429)
  })

  it('returns 429 after exceeding the rate limit', async () => {
    const ip = uniqueIp()
    const send = () =>
      POST(makeRequest(makeFormData(makeFile('notes.txt', 'text/plain')), ip))

    // Fire 5 requests — all pass the rate limiter (even though they fail at
    // MIME-type validation with 415).
    for (let i = 0; i < 5; i++) {
      const res = await send()
      expect(res.status).not.toBe(429)
    }

    // The 6th request from the same IP should be rate-limited.
    const res = await send()
    expect(res.status).toBe(429)
    const body = await res.json()
    expect(body.ok).toBe(false)
    expect(body.error).toBe('Too many requests. Please wait a moment.')
  })
})
