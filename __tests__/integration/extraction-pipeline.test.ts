/**
 * @jest-environment node
 */

/**
 * Integration tests — the extraction pipeline, end to end.
 * ════════════════════════════════════════════════════════════════════════════
 * WHAT "END TO END" MEANS HERE, AND WHERE THE MOCK SITS:
 *
 * The pipeline is: file → Claude → parse/split → map → CalendarEvent[]. The only
 * part we cannot run for real in a unit test is the network call to Claude, so we
 * mock the Anthropic SDK at its BOUNDARY — the single seam where our code hands
 * off to someone else's — and let EVERYTHING downstream run for real: delimiter
 * splitting, JSON parsing, markdown-fence stripping, date/time formatting,
 * cal-string building, and confidence sanitisation.
 *
 * This is deliberately different from the unit tests. Unit tests pin one function
 * (`sanitizeLevel`, `parseFrame`). These prove the PIECES COMPOSE: given a
 * realistic model response for a real school letter, does the whole pipeline hand
 * back well-shaped events with a trustworthy confidence value on every item? A
 * regression that a unit test would miss — e.g. the mapper silently dropping the
 * confidence object, or the splitter and parser disagreeing — shows up here.
 *
 * The fixtures (../fixtures/school-messages) carry the source letter, the canned
 * model response, and the expected output together. Mocking at the SDK boundary
 * (rather than stubbing our own functions) is exactly what lets the follow-up
 * eval harness reuse these fixtures: swap the mock for a real API call, keep the
 * same `expected`, and you have an eval instead of an integration test.
 */

const mockCreate = jest.fn()
const mockStream = jest.fn()

// Mock the SDK's default export — the one boundary the whole pipeline depends on.
// getClient() in lib/extract-events constructs `new Anthropic(...)`, so we make
// the constructor hand back an object exposing the two methods the code calls.
jest.mock('@anthropic-ai/sdk', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    messages: { create: mockCreate, stream: mockStream },
  })),
}))

import { extractEventsFromFile, streamEventsFromFile, type StreamChunk } from '@/lib/extract-events'
import type { CalendarEvent, ConfidenceLevel } from '@/types'
import { SCHOOL_MESSAGE_FIXTURES } from '../fixtures/school-messages'

const VALID_LEVELS: ConfidenceLevel[] = ['high', 'medium', 'low']

/** Make the non-streaming SDK call return a given raw text response once. */
function mockCreateReturns(text: string) {
  mockCreate.mockResolvedValueOnce({
    content: [{ type: 'text', text }],
    usage: { input_tokens: 10, output_tokens: 20 },
    stop_reason: 'end_turn',
  })
}

/** A fake MessageStream that yields the given text chunks as text_delta events. */
function fakeStream(chunks: string[]) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const text of chunks) {
        yield { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } }
      }
    },
  }
}

async function drain(gen: AsyncGenerator<StreamChunk>): Promise<StreamChunk[]> {
  const out: StreamChunk[] = []
  for await (const chunk of gen) out.push(chunk)
  return out
}

/**
 * Shared shape check: every event the pipeline emits must be a well-formed
 * CalendarEvent carrying a usable confidence signal — regardless of the fixture.
 * This is the invariant the eval harness will also lean on.
 */
function assertEventShape(event: CalendarEvent, index: number) {
  expect(event.id).toBe(index + 1) // ids are 1-based and sequential
  expect(typeof event.title).toBe('string')
  expect(event.title.length).toBeGreaterThan(0)
  expect(typeof event.date).toBe('string') // formatted display date
  expect(typeof event.cal).toBe('string') // Google Calendar range string
  expect(event.cal.length).toBeGreaterThan(0)

  // The heart of the product promise: a confidence value on EVERY item, and each
  // present level is one of the three valid levels (never a raw model string).
  expect(VALID_LEVELS).toContain(event.confidence.title)
  expect(VALID_LEVELS).toContain(event.confidence.datetime)
  if (event.confidence.location !== undefined) {
    expect(VALID_LEVELS).toContain(event.confidence.location)
  }
}

describe('extraction pipeline (non-streaming) over realistic school messages', () => {
  beforeEach(() => mockCreate.mockReset())

  // Run the SAME assertions across every fixture. `it.each` keeps the fixture
  // name in the test title, so a failure points straight at the offending case.
  it.each(SCHOOL_MESSAGE_FIXTURES)(
    'extracts structured, confidence-tagged events from "$name"',
    async (fixture) => {
      mockCreateReturns(fixture.modelResponse)

      // A base64 string + mime type is all the pipeline needs; with the SDK
      // mocked the file bytes are irrelevant — the model response is what drives
      // the output, which is precisely the seam an eval would swap for real.
      const events = await extractEventsFromFile('base64-file-bytes', 'application/pdf')

      expect(events).toHaveLength(fixture.expected.eventCount)

      events.forEach((event, i) => {
        const expected = fixture.expected.events[i]
        assertEventShape(event, i)
        expect(event.title).toBe(expected.title)
        expect(event.time !== null).toBe(expected.timed) // timed vs all-day
        expect(event.location).toBe(expected.location)
        // Full confidence object, including whether the location key is present.
        expect(event.confidence).toEqual(expected.confidence)
      })
    },
  )
})

describe('extraction pipeline (streaming) produces the same events', () => {
  beforeEach(() => mockStream.mockReset())

  // The upload route uses the streaming generator, not the non-streaming call, so
  // we verify the streaming path over a representative fixture: the summary must
  // stream as deltas, and the terminal `result` must carry the same mapped events
  // (never partial JSON). Chunking the response mid-word also exercises the
  // delimiter hold-back guard against a realistic token split.
  it('streams the summary then yields the fully-mapped events for the newsletter', async () => {
    const fixture = SCHOOL_MESSAGE_FIXTURES.find((f) => f.name === 'multi-event-newsletter')!

    // Split the canned response into three arbitrary chunks to mimic token-by-
    // token streaming (the boundaries deliberately don't align with the delimiter).
    const third = Math.floor(fixture.modelResponse.length / 3)
    const chunks = [
      fixture.modelResponse.slice(0, third),
      fixture.modelResponse.slice(third, third * 2),
      fixture.modelResponse.slice(third * 2),
    ]
    mockStream.mockImplementationOnce(() => fakeStream(chunks))

    const emitted = await drain(streamEventsFromFile('base64-file-bytes', 'application/pdf'))

    const deltas = emitted.filter((c) => c.type === 'summary_delta')
    const result = emitted.find((c) => c.type === 'result') as Extract<
      StreamChunk,
      { type: 'result' }
    >

    // Summary streamed as prose, and no delimiter fragment ever leaked into it.
    expect(deltas.length).toBeGreaterThan(0)
    const summaryText = deltas.map((d) => (d as { text: string }).text).join('')
    expect(summaryText).not.toContain('<')

    // Terminal result: same count and same confidence-tagged shape as expected.
    expect(result).toBeTruthy()
    expect(result.summary.length).toBeGreaterThan(0)
    expect(result.events).toHaveLength(fixture.expected.eventCount)
    result.events.forEach((event, i) => {
      assertEventShape(event, i)
      expect(event.title).toBe(fixture.expected.events[i].title)
      expect(event.confidence).toEqual(fixture.expected.events[i].confidence)
    })
  })
})
