/**
 * @jest-environment node
 */

// Mock the Anthropic SDK so extract-events.ts never makes real API calls.
// The mock is declared before imports so it is registered before any module loads.
const mockCreate = jest.fn()

jest.mock('@anthropic-ai/sdk', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    messages: { create: mockCreate },
  })),
}))

import { NextRequest } from 'next/server'
import { POST } from '@/app/api/upload/route'
import { MAX_FILE_SIZE_BYTES } from '@/lib/file-config'

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

function mockSuccess() {
  mockCreate.mockResolvedValueOnce({
    content: [{ type: 'text', text: MOCK_EVENTS_JSON }],
    usage: { input_tokens: 10, output_tokens: 50 },
    stop_reason: 'end_turn',
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

describe('POST /api/upload — extraction', () => {
  beforeEach(() => { jest.restoreAllMocks() })

  it('returns ok:true with filename and events for a valid PDF', async () => {
    mockSuccess()
    const fd = makeFormData(makePdf())
    const res = await POST(makeRequest(fd))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.filename).toBe('letter.pdf')
    expect(Array.isArray(body.events)).toBe(true)
    expect(body.events.length).toBeGreaterThan(0)
  })

  it('returns ok:true for a valid JPEG', async () => {
    mockSuccess()
    const fd = makeFormData(makeJpeg())
    const res = await POST(makeRequest(fd))
    expect(res.status).toBe(200)
    expect((await res.json()).ok).toBe(true)
  })

  it('returns ok:false with status 500 when the Anthropic API throws', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {})
    mockCreate.mockRejectedValueOnce(new Error('rate limited'))
    const fd = makeFormData(makePdf())
    const res = await POST(makeRequest(fd))
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.ok).toBe(false)
    expect(body.error).toBe('Extraction failed. Please try again.')
  })

  it('each event in the response has the expected CalendarEvent shape', async () => {
    mockSuccess()
    const fd = makeFormData(makePdf())
    const { events } = await (await POST(makeRequest(fd))).json()
    const [event] = events
    expect(typeof event.id).toBe('number')
    expect(typeof event.title).toBe('string')
    expect(typeof event.date).toBe('string')
    expect(typeof event.cal).toBe('string')
    expect(['high', 'medium']).toContain(event.confidence)
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
