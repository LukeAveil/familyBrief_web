/**
 * @jest-environment node
 */

const mockCreate = jest.fn()
const mockStream = jest.fn()

jest.mock('@anthropic-ai/sdk', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    messages: { create: mockCreate, stream: mockStream },
  })),
}))

import {
  extractEventsFromFile,
  streamEventsFromFile,
  splitOnDelimiter,
  EVENTS_DELIMITER,
  TruncatedExtractionError,
  type StreamChunk,
} from '@/lib/extract-events'

function mockResponse(text: string) {
  mockCreate.mockResolvedValueOnce({
    content: [{ type: 'text', text }],
    usage: { input_tokens: 10, output_tokens: 20 },
    stop_reason: 'end_turn',
  })
}

// A fake MessageStream: async-iterable yielding text_delta events for each of the
// given chunk strings, exactly the shape streamEventsFromFile consumes.
// `end` optionally appends the SDK's terminal message_delta frame, which is where
// stop_reason and the output token count arrive.
function fakeStream(chunks: string[], end?: { stopReason: string; outputTokens?: number }) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const text of chunks) {
        yield { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } }
      }
      if (end) {
        yield {
          type: 'message_delta',
          delta: { stop_reason: end.stopReason, stop_sequence: null },
          usage: { output_tokens: end.outputTokens ?? 0 },
        }
      }
    },
  }
}

async function drain(gen: AsyncGenerator<StreamChunk>): Promise<StreamChunk[]> {
  const out: StreamChunk[] = []
  for await (const chunk of gen) out.push(chunk)
  return out
}

describe('extractEventsFromFile', () => {
  beforeEach(() => mockCreate.mockClear())

  it('returns an empty array when Claude returns []', async () => {
    mockResponse('[]')
    const result = await extractEventsFromFile('base64data', 'application/pdf')
    expect(result).toEqual([])
  })

  it('strips markdown code fences from the response', async () => {
    mockResponse('```json\n[]\n```')
    const result = await extractEventsFromFile('base64data', 'application/pdf')
    expect(result).toEqual([])
  })

  it('maps a single extracted event to a CalendarEvent', async () => {
    mockResponse(
      JSON.stringify([
        {
          title: 'Sports Day',
          date: '2025-06-26',
          time: '09:30',
          endTime: '12:00',
          location: 'Playing Fields',
          description: 'Wear PE kit',
          category: 'school',
          confidence: { title: 'high', datetime: 'high', location: 'high' },
        },
      ]),
    )

    const [event] = await extractEventsFromFile('base64data', 'application/pdf')
    expect(event.id).toBe(1)
    expect(event.title).toBe('Sports Day')
    expect(event.date).toContain('2025')
    expect(event.time).toBe('9:30 AM – 12:00 PM')
    expect(event.location).toBe('Playing Fields')
    expect(event.notes).toBe('Wear PE kit')
    expect(event.confidence).toEqual({ title: 'high', datetime: 'high', location: 'high' })
  })

  it('passes the model-assessed per-field confidence through', async () => {
    mockResponse(
      JSON.stringify([
        {
          title: 'Bake Sale',
          date: '2025-06-26',
          location: 'the hall',
          category: 'social',
          confidence: { title: 'high', datetime: 'medium', location: 'low' },
        },
      ]),
    )
    const [event] = await extractEventsFromFile('base64data', 'application/pdf')
    expect(event.confidence).toEqual({ title: 'high', datetime: 'medium', location: 'low' })
  })

  it('defaults missing/invalid confidence fields to medium (honest fallback)', async () => {
    mockResponse(
      JSON.stringify([
        {
          title: 'Mystery Event',
          date: '2025-06-26',
          category: 'other',
          confidence: { title: 'bogus' },
        },
      ]),
    )
    const [event] = await extractEventsFromFile('base64data', 'application/pdf')
    // No location on the event → no location confidence key.
    expect(event.confidence).toEqual({ title: 'medium', datetime: 'medium' })
  })

  it('omits location confidence when the event has no location', async () => {
    mockResponse(
      JSON.stringify([
        {
          title: 'Assembly',
          date: '2025-06-26',
          category: 'school',
          confidence: { title: 'high', datetime: 'high', location: 'high' },
        },
      ]),
    )
    const [event] = await extractEventsFromFile('base64data', 'application/pdf')
    expect(event.confidence.location).toBeUndefined()
  })

  it('assigns sequential ids starting from 1', async () => {
    mockResponse(
      JSON.stringify([
        { title: 'Event A', date: '2025-06-01', category: 'school' },
        { title: 'Event B', date: '2025-06-02', category: 'school' },
      ]),
    )
    const events = await extractEventsFromFile('base64data', 'image/jpeg')
    expect(events[0].id).toBe(1)
    expect(events[1].id).toBe(2)
  })

  it('produces a null time when no time is in the extracted event', async () => {
    mockResponse(JSON.stringify([{ title: 'Last Day', date: '2025-07-18', category: 'school' }]))
    const [event] = await extractEventsFromFile('base64data', 'application/pdf')
    expect(event.time).toBeNull()
  })

  it('produces a null location when not present', async () => {
    mockResponse(JSON.stringify([{ title: 'Event', date: '2025-06-01', category: 'other' }]))
    const [event] = await extractEventsFromFile('base64data', 'application/pdf')
    expect(event.location).toBeNull()
  })

  it('builds an all-day cal string when no time is provided', async () => {
    mockResponse(JSON.stringify([{ title: 'Event', date: '2025-06-26', category: 'school' }]))
    const [event] = await extractEventsFromFile('base64data', 'application/pdf')
    expect(event.cal).toMatch(/^20250626\/20250627$/)
  })

  it('builds a timed cal string when time is provided', async () => {
    mockResponse(
      JSON.stringify([
        {
          title: 'Event',
          date: '2025-06-26',
          time: '09:30',
          endTime: '12:00',
          category: 'school',
        },
      ]),
    )
    const [event] = await extractEventsFromFile('base64data', 'application/pdf')
    expect(event.cal).toBe('20250626T093000/20250626T120000')
  })

  it('throws when the Anthropic API call fails', async () => {
    mockCreate.mockRejectedValueOnce(new Error('rate limited'))
    await expect(extractEventsFromFile('base64data', 'application/pdf')).rejects.toThrow(
      'rate limited',
    )
  })

  it('throws a descriptive error when Claude returns non-JSON', async () => {
    mockResponse('Sorry, I cannot process this document.')
    await expect(extractEventsFromFile('base64data', 'application/pdf')).rejects.toThrow(
      /invalid JSON/i,
    )
  })

  it('falls back to all-day cal string when time is malformed', async () => {
    mockResponse(
      JSON.stringify([
        {
          title: 'Event',
          date: '2025-06-26',
          time: 'noon',
          category: 'school',
        },
      ]),
    )
    const [event] = await extractEventsFromFile('base64data', 'application/pdf')
    expect(event.cal).toMatch(/^20250626\/20250627$/)
  })

  it('falls back to one hour after start when endTime is malformed', async () => {
    mockResponse(
      JSON.stringify([
        {
          title: 'Event',
          date: '2025-06-26',
          time: '09:30',
          endTime: 'noon',
          category: 'school',
        },
      ]),
    )
    const [event] = await extractEventsFromFile('base64data', 'application/pdf')
    // Should fall back to start+1h: 10:30
    expect(event.cal).toBe('20250626T093000/20250626T103000')
  })

  it('correctly zero-pads endTime components', async () => {
    mockResponse(
      JSON.stringify([
        {
          title: 'Event',
          date: '2025-06-26',
          time: '09:05',
          endTime: '09:45',
          category: 'school',
        },
      ]),
    )
    const [event] = await extractEventsFromFile('base64data', 'application/pdf')
    expect(event.cal).toBe('20250626T090500/20250626T094500')
  })
})

describe('splitOnDelimiter', () => {
  it('splits summary from JSON when the delimiter is present', () => {
    const [summary, json] = splitOnDelimiter(`A summary.\n${EVENTS_DELIMITER}\n[]`)
    expect(summary).toBe('A summary.\n')
    expect(json.trim()).toBe('[]')
  })

  it('treats the whole response as JSON when the delimiter is absent', () => {
    // Keeps the non-streaming path (and its pure-JSON mocks) working unchanged.
    const [summary, json] = splitOnDelimiter('[]')
    expect(summary).toBe('')
    expect(json).toBe('[]')
  })

  it('yields an empty summary when the delimiter is at the very start', () => {
    const [summary, json] = splitOnDelimiter(`${EVENTS_DELIMITER}[1,2]`)
    expect(summary).toBe('')
    expect(json).toBe('[1,2]')
  })
})

describe('streamEventsFromFile', () => {
  beforeEach(() => mockStream.mockReset())

  const EVENT_JSON = JSON.stringify([
    {
      title: 'Sports Day',
      date: '2025-06-26',
      time: '09:30',
      category: 'school',
      confidence: { title: 'high', datetime: 'high' },
    },
  ])

  it('streams the summary then yields a terminal result with mapped events', async () => {
    mockStream.mockImplementationOnce(() =>
      fakeStream([`Summary here.\n`, `${EVENTS_DELIMITER}\n`, EVENT_JSON]),
    )

    const chunks = await drain(streamEventsFromFile('b64', 'application/pdf'))
    const deltas = chunks.filter((c) => c.type === 'summary_delta')
    const result = chunks.find((c) => c.type === 'result')

    // Only the pre-delimiter prose is streamed as summary.
    expect(deltas.map((c) => (c as { text: string }).text).join('')).toBe('Summary here.\n')
    // The delimiter itself never leaks into a summary delta.
    for (const d of deltas) expect((d as { text: string }).text).not.toContain('<')

    expect(result).toBeTruthy()
    const r = result as Extract<StreamChunk, { type: 'result' }>
    expect(r.summary).toBe('Summary here.')
    expect(r.events).toHaveLength(1)
    expect(r.events[0].title).toBe('Sports Day')
    expect(r.events[0].confidence).toEqual({ title: 'high', datetime: 'high' })
  })

  it('never leaks a delimiter that straddles two token chunks', async () => {
    // The delimiter is split across the chunk boundary: "…<<<EVE" | "NTS_JSON>>>…".
    // The hold-back guard must ensure no fragment ('<') reaches the client.
    mockStream.mockImplementationOnce(() =>
      fakeStream(['This letter has news.\n<<<EVE', 'NTS_JSON>>>\n[]']),
    )

    const chunks = await drain(streamEventsFromFile('b64', 'application/pdf'))
    const summary = chunks
      .filter((c) => c.type === 'summary_delta')
      .map((c) => (c as { text: string }).text)
      .join('')

    expect(summary).toBe('This letter has news.\n')
    expect(summary).not.toContain('<')
    const result = chunks.find((c) => c.type === 'result') as Extract<
      StreamChunk,
      { type: 'result' }
    >
    expect(result.events).toEqual([])
  })

  it('still parses events when the model omits the delimiter (compliance edge)', async () => {
    // A missing delimiter is a model-compliance edge: the whole response is treated
    // as JSON, so events remain correct even though there is no clean summary.
    mockStream.mockImplementationOnce(() => fakeStream([EVENT_JSON]))

    const chunks = await drain(streamEventsFromFile('b64', 'application/pdf'))
    const result = chunks.find((c) => c.type === 'result') as Extract<
      StreamChunk,
      { type: 'result' }
    >
    expect(result.summary).toBe('')
    expect(result.events).toHaveLength(1)
    expect(result.events[0].title).toBe('Sports Day')
  })

  it('propagates an error thrown mid-stream (route wraps this in an error frame)', async () => {
    mockStream.mockImplementationOnce(() => ({
      async *[Symbol.asyncIterator]() {
        throw new Error('rate limited')
      },
    }))
    await expect(drain(streamEventsFromFile('b64', 'application/pdf'))).rejects.toThrow(
      'rate limited',
    )
  })

  it('throws a descriptive error when the JSON after the delimiter is invalid', async () => {
    mockStream.mockImplementationOnce(() => fakeStream([`Summary.\n${EVENTS_DELIMITER}\nnot json`]))
    await expect(drain(streamEventsFromFile('b64', 'application/pdf'))).rejects.toThrow(
      /invalid JSON/i,
    )
  })

  // ─── Truncation ─────────────────────────────────────────────────────────────
  // A letter with more events than the token budget allows gets its JSON array cut
  // off mid-object. The cause is a budget, the symptom is a parse failure, and the
  // two want different responses — so they must not be conflated.

  it('throws TruncatedExtractionError when the model stops on max_tokens', async () => {
    mockStream.mockImplementationOnce(() =>
      fakeStream([`Summary.\n${EVENTS_DELIMITER}\n[{"title":"Sports Day","da`], {
        stopReason: 'max_tokens',
        outputTokens: 16000,
      }),
    )
    await expect(drain(streamEventsFromFile('b64', 'application/pdf'))).rejects.toThrow(
      TruncatedExtractionError,
    )
  })

  it('does not misreport truncation as invalid JSON', async () => {
    mockStream.mockImplementationOnce(() =>
      fakeStream([`Summary.\n${EVENTS_DELIMITER}\n[{"title":"Sports Day","da`], {
        stopReason: 'max_tokens',
      }),
    )
    // The truncated array is unparseable, so without the stop_reason check this
    // would surface as "invalid JSON" — a diagnosis pointing at the wrong problem.
    await expect(drain(streamEventsFromFile('b64', 'application/pdf'))).rejects.not.toThrow(
      /invalid JSON/i,
    )
  })

  it('surfaces stop_reason and output tokens on the result for logging', async () => {
    mockStream.mockImplementationOnce(() =>
      fakeStream([`Summary.\n${EVENTS_DELIMITER}\n${EVENT_JSON}`], {
        stopReason: 'end_turn',
        outputTokens: 842,
      }),
    )
    const chunks = await drain(streamEventsFromFile('b64', 'application/pdf'))
    const result = chunks.find((c) => c.type === 'result')

    expect(result).toMatchObject({ stopReason: 'end_turn', outputTokens: 842 })
  })

  it('still completes when the stream omits a message_delta frame', async () => {
    // Older mocks and any stream that ends without the terminal frame must keep
    // working — an absent stop_reason means "no evidence of truncation", not
    // "assume the worst".
    mockStream.mockImplementationOnce(() =>
      fakeStream([`Summary.\n${EVENTS_DELIMITER}\n${EVENT_JSON}`]),
    )
    const chunks = await drain(streamEventsFromFile('b64', 'application/pdf'))

    expect(chunks.some((c) => c.type === 'result')).toBe(true)
  })
})
