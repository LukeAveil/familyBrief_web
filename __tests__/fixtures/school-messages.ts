/**
 * Sample school messages for the extraction pipeline — the shared fixture set.
 * ════════════════════════════════════════════════════════════════════════════
 * WHY THIS FILE EXISTS, AND ITS CONTRACT:
 *
 * The pipeline takes a base64 FILE, not a string, and calls Claude. In tests we
 * mock the Anthropic SDK at its boundary, so the "school message" effectively
 * lives in TWO places that a fixture ties together:
 *
 *   sourceLetter  — the human-readable original. This is the real-world INPUT.
 *                   A future eval harness will send THIS to the live API.
 *   modelResponse — the raw text we make the mocked model return for that input:
 *                   a summary, the EVENTS_DELIMITER, then the JSON array. This is
 *                   what Claude *would* produce; the integration test feeds it in
 *                   so the run is deterministic and offline.
 *   expected      — ground truth: how many events, and the shape/confidence of
 *                   each, once the pipeline has mapped them to CalendarEvents.
 *
 * How this generalises to the eval harness (the follow-up):
 *   - Integration test (now):  mock returns `modelResponse` → assert against `expected`.
 *   - Eval harness (later):    send `sourceLetter` to the REAL API → compare the
 *                              live output against `expected`, scoring drift.
 * Same fixtures, same ground truth, different source of the model output. That is
 * why the source letter and the expectations are kept, not just the canned JSON.
 *
 * `modelResponse` is assembled from the SAME `EVENTS_DELIMITER` the production
 * splitter uses (imported below), so a fixture can never disagree with the real
 * summary|JSON boundary — if that delimiter ever changes, these fixtures follow.
 */

import { EVENTS_DELIMITER } from '@/lib/extract-events'
import type { ConfidenceLevel } from '@/types'

/** The raw per-event shape Claude emits (before the pipeline maps it). */
interface RawModelEvent {
  title: string
  date: string
  endDate?: string
  time?: string
  endTime?: string
  location?: string
  description?: string
  category: 'school' | 'activity' | 'medical' | 'social' | 'other'
  confidence?: { title?: string; datetime?: string; location?: string }
}

/** What we assert about ONE mapped CalendarEvent the pipeline produces. */
export interface ExpectedEvent {
  title: string
  /** true when the mapped event has a non-null time (timed vs all-day). */
  timed: boolean
  location: string | null
  confidence: {
    title: ConfidenceLevel
    datetime: ConfidenceLevel
    /** Present only when the event has a location (mirrors EventConfidence). */
    location?: ConfidenceLevel
  }
}

export interface SchoolMessageFixture {
  name: string
  description: string
  /** The human-readable original message — the eval-harness input. */
  sourceLetter: string
  /** Raw model output: summary + delimiter + JSON. Fed to the mocked SDK. */
  modelResponse: string
  expected: {
    eventCount: number
    events: ExpectedEvent[]
  }
}

/**
 * Assemble a realistic raw model response: the friendly summary, then the
 * delimiter on its own line, then the JSON array — exactly the ordering
 * `buildPrompt` instructs the model to use and `splitOnDelimiter` expects.
 */
function buildModelResponse(summary: string, events: RawModelEvent[]): string {
  return `${summary}\n${EVENTS_DELIMITER}\n${JSON.stringify(events, null, 2)}`
}

export const SCHOOL_MESSAGE_FIXTURES: SchoolMessageFixture[] = [
  // ── 1. The easy case: one event, everything stated explicitly ──────────────
  // Establishes the happy path — a single clearly-dated, timed event with a
  // named venue. Every field should come back "high" confidence.
  {
    name: 'single-clear-event',
    description: 'A permission slip with one fully-specified, high-confidence event.',
    sourceLetter: [
      'Dear Parents and Carers,',
      '',
      'Year 4 will be visiting the Natural History Museum on Wednesday 14th October 2026.',
      'The coach leaves school at 8:45am and we expect to return by 3:30pm.',
      'Please send your child in school uniform with a named packed lunch.',
      '',
      'Kind regards,',
      'Mrs Patel',
    ].join('\n'),
    modelResponse: buildModelResponse(
      "This is a permission slip for Year 4's trip to the Natural History Museum. There's one date for your diary: the trip itself, with a clearly stated departure and return time.",
      [
        {
          title: 'Year 4 Trip to the Natural History Museum',
          date: '2026-10-14',
          time: '08:45',
          endTime: '15:30',
          location: 'Natural History Museum',
          description: 'Bring a named packed lunch and wear school uniform.',
          category: 'school',
          confidence: { title: 'high', datetime: 'high', location: 'high' },
        },
      ],
    ),
    expected: {
      eventCount: 1,
      events: [
        {
          title: 'Year 4 Trip to the Natural History Museum',
          timed: true,
          location: 'Natural History Museum',
          confidence: { title: 'high', datetime: 'high', location: 'high' },
        },
      ],
    },
  },

  // ── 2. The realistic case: a newsletter with several mixed events ──────────
  // Exercises multiple events in one message, an all-day event (no time, no
  // location → no location confidence), and a fuzzier venue ("the playground")
  // that the model rates lower. This is the shape most real inputs take.
  {
    name: 'multi-event-newsletter',
    description:
      'A monthly newsletter with three events: an all-day non-uniform day, a timed Parents Evening, and a fair with a vaguer location.',
    sourceLetter: [
      'October Newsletter',
      '',
      'A few dates for your diary this half term:',
      '- Non-uniform day on Friday 18th October (bring £1 for charity).',
      "- Parents' Evening on Tuesday 22nd October, 4:00pm–7:00pm in the School Hall.",
      '- Autumn Fair on Saturday 7th November, 11am til 2pm out on the playground.',
      '',
      'Thank you for your continued support.',
    ].join('\n'),
    modelResponse: buildModelResponse(
      "This is the October newsletter. I found three dates for your diary: a non-uniform day, Parents' Evening, and the Autumn Fair. Most details are clearly stated.",
      [
        {
          title: 'Non-Uniform Day',
          date: '2026-10-18',
          description: 'Bring £1 for charity.',
          category: 'school',
          confidence: { title: 'high', datetime: 'high' },
        },
        {
          title: "Parents' Evening",
          date: '2026-10-22',
          time: '16:00',
          endTime: '19:00',
          location: 'School Hall',
          category: 'school',
          confidence: { title: 'high', datetime: 'high', location: 'high' },
        },
        {
          title: 'Autumn Fair',
          date: '2026-11-07',
          time: '11:00',
          endTime: '14:00',
          location: 'the playground',
          category: 'social',
          confidence: { title: 'high', datetime: 'medium', location: 'medium' },
        },
      ],
    ),
    expected: {
      eventCount: 3,
      events: [
        {
          title: 'Non-Uniform Day',
          timed: false,
          location: null,
          // No location on the event → no location confidence key.
          confidence: { title: 'high', datetime: 'high' },
        },
        {
          title: "Parents' Evening",
          timed: true,
          location: 'School Hall',
          confidence: { title: 'high', datetime: 'high', location: 'high' },
        },
        {
          title: 'Autumn Fair',
          timed: true,
          location: 'the playground',
          confidence: { title: 'high', datetime: 'medium', location: 'medium' },
        },
      ],
    },
  },

  // ── 3. The hard case: an informal, uncertain message ───────────────────────
  // The whole point of the confidence feature. A vague WhatsApp-style note where
  // the date and venue are unconfirmed; the model should honestly flag low
  // confidence rather than present a guess as fact. Proves confidence lands on
  // every item and that low/medium levels survive the pipeline intact.
  {
    name: 'ambiguous-low-confidence',
    description: 'An informal, uncertain message that should yield low/medium confidence.',
    sourceLetter: [
      'Hi all 👋 — think the bake sale is happening sometime next week, maybe Thursday?',
      "Probably in the hall after school. I'll confirm the details once I know more!",
    ].join('\n'),
    modelResponse: buildModelResponse(
      'This looks like an informal message about a bake sale. The details are uncertain — the day and location are not confirmed — so please double-check before relying on it.',
      [
        {
          title: 'Bake Sale',
          date: '2026-09-24',
          time: '15:30',
          location: 'the hall',
          category: 'social',
          confidence: { title: 'medium', datetime: 'low', location: 'low' },
        },
      ],
    ),
    expected: {
      eventCount: 1,
      events: [
        {
          title: 'Bake Sale',
          timed: true,
          location: 'the hall',
          confidence: { title: 'medium', datetime: 'low', location: 'low' },
        },
      ],
    },
  },
]
