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

// ─── Helpers ─────────────────────────────────────────────────────────────────

const makeRequest = (formData: FormData) =>
  new NextRequest('http://localhost/api/upload', { method: 'POST', body: formData })

const makeFormData = (file: File, fieldName = 'file') => {
  const fd = new FormData()
  fd.append(fieldName, file)
  return fd
}

const makeFile = (name: string, type: string, sizeBytes = 100) =>
  new File([new Uint8Array(sizeBytes)], name, { type })

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
    const fd = makeFormData(makeFile('doc.pdf', 'application/pdf'), 'document')
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

  it('returns 413 when the file exceeds the size limit', async () => {
    const fd = makeFormData(makeFile('big.pdf', 'application/pdf', MAX_FILE_SIZE_BYTES + 1))
    const res = await POST(makeRequest(fd))
    expect(res.status).toBe(413)
    expect((await res.json()).ok).toBe(false)
  })

  it('accepts a file exactly at the size limit', async () => {
    mockSuccess()
    const fd = makeFormData(makeFile('max.pdf', 'application/pdf', MAX_FILE_SIZE_BYTES))
    const res = await POST(makeRequest(fd))
    expect(res.status).toBe(200)
  })
})

// ─── Extraction tests ─────────────────────────────────────────────────────────

describe('POST /api/upload — extraction', () => {
  it('returns ok:true with filename and events for a valid PDF', async () => {
    mockSuccess()
    const fd = makeFormData(makeFile('letter.pdf', 'application/pdf'))
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
    const fd = makeFormData(makeFile('photo.jpg', 'image/jpeg'))
    const res = await POST(makeRequest(fd))
    expect(res.status).toBe(200)
    expect((await res.json()).ok).toBe(true)
  })

  it('returns ok:false with status 500 when the Anthropic API throws', async () => {
    mockCreate.mockRejectedValueOnce(new Error('rate limited'))
    const fd = makeFormData(makeFile('letter.pdf', 'application/pdf'))
    const res = await POST(makeRequest(fd))
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.ok).toBe(false)
    expect(body.error).toBe('rate limited')
  })

  it('each event in the response has the expected CalendarEvent shape', async () => {
    mockSuccess()
    const fd = makeFormData(makeFile('letter.pdf', 'application/pdf'))
    const { events } = await (await POST(makeRequest(fd))).json()
    const [event] = events
    expect(typeof event.id).toBe('number')
    expect(typeof event.title).toBe('string')
    expect(typeof event.date).toBe('string')
    expect(typeof event.cal).toBe('string')
    expect(['high', 'medium']).toContain(event.confidence)
  })
})
