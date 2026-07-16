/**
 * Event extraction — the model-facing layer.
 * ────────────────────────────────────────────────────────────────────────────
 * A school letter produces TWO things from a single Claude call:
 *   1. a short human-readable SUMMARY — safe to show as it streams in, and
 *   2. a structured JSON array of EVENTS — *actionable* (a parent taps "add to
 *      calendar"), so we must never surface a half-formed one.
 *
 * We get both from one request by asking Claude to write the summary, then a
 * delimiter (EVENTS_DELIMITER), then the JSON. That ordering is what lets us
 * stream the safe half live while holding the actionable half back until it's
 * fully parsed. See `buildPrompt` for the instruction and `streamEventsFromFile`
 * for the split.
 *
 * Where this sits in the pipeline:
 *   file → Claude (stream) → streamEventsFromFile → app/api/upload (SSE)
 *        → components/ScreenRouter (reads SSE) → Processing / Results screens
 *
 * Exports:
 *   - streamEventsFromFile  — streaming path used by the upload route.
 *   - extractEventsFromFile — non-streaming convenience (whole result at once).
 *   - splitOnDelimiter / EVENTS_DELIMITER — the summary|JSON boundary, shared so
 *     the streamer, the non-streaming path, and the tests all agree on it.
 */

import Anthropic from '@anthropic-ai/sdk'
import type { CalendarEvent, ConfidenceLevel, EventConfidence } from '@/types'

const MODEL = 'claude-sonnet-4-6'
// Bumped from 1024 → 2048 to leave room for the streamed summary prose that now
// precedes the JSON array (the event payload itself is small).
const MAX_TOKENS = 2048

// Sentinel the model writes between the human-readable summary and the JSON
// array. Exported so the streaming splitter and tests share one source of truth.
// Chosen to be distinctive enough that it will never appear in a real summary.
export const EVENTS_DELIMITER = '<<<EVENTS_JSON>>>'

// Lazy client — created on first use so importing this module never throws
// even when ANTHROPIC_API_KEY is absent (e.g. in tests that mock the SDK).
let _client: Anthropic | null = null
const getClient = () => {
  if (!_client) {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY environment variable is not set')
    }
    _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  }
  return _client
}

// ─── Prompt ────────────────────────────────────────────────────────────────

function buildPrompt(): string {
  const today = new Date().toISOString().split('T')[0]
  return `You are a helpful assistant that extracts calendar events from school letters, newsletters, and activity schedules for parents.

Look at this document and extract ALL events, deadlines, and important dates.

Today's date is ${today}.

Respond in TWO parts, in this exact order:

PART 1 — A short, friendly summary for the parent (2-3 sentences) describing what this document is and what you found: how many events there are and the kinds of things coming up. Write in plain, warm language. No markdown, no bullet points, no headings.

PART 2 — On a new line, write exactly ${EVENTS_DELIMITER} and then, after it, output ONLY a valid JSON array of the events. No preamble, no explanation, no markdown code fences.

For each event, extract:
- title: clear, concise event name
- date: YYYY-MM-DD format. If the year is not shown: use the current year if the month/day falls on or after today; only use next year if the date has already passed this year.
- endDate: YYYY-MM-DD if multi-day (optional)
- time: HH:MM in 24hr format (optional)
- endTime: HH:MM in 24hr format (optional)
- location: where it takes place (optional)
- description: any important details parents need to know (optional)
- category: one of school|activity|medical|social|other
- confidence: an object honestly assessing how sure you are of each of the three things a parent will rely on. Assess each field INDEPENDENTLY — a clearly stated date can be "high" while the title is "low". Each value is exactly one of "high", "medium", or "low":
    - confidence.title    — how sure you are what the event actually is
    - confidence.datetime — how sure you are of the date and time
    - confidence.location — how sure you are of the location (OMIT this key entirely when there is no location)
  Use this rule for every field:
    - "high"   — explicitly and unambiguously stated in the document (e.g. a full date with year and a clearly written time; the event named in plain words; a clearly named venue).
    - "medium" — present but inferred: a date with no year, a relative reference like "next Friday" resolved from today's date, an abbreviated or ambiguous title, or a vague location like "the hall".
    - "low"    — genuinely unclear, guessed, or pieced together from weak cues.

Example confidence object: "confidence": { "title": "high", "datetime": "medium", "location": "low" }

If no events are found, still write a brief summary, then ${EVENTS_DELIMITER} followed by an empty array [].`
}

/**
 * Split the model's raw output into the human-readable summary (before the
 * delimiter) and the JSON payload (after it). When the delimiter is absent —
 * e.g. the model omits it, or a caller uses an older prompt — the whole
 * response is treated as the JSON payload and the summary is empty. That keeps
 * the non-streaming path (and its tests, which mock pure-JSON responses)
 * working unchanged.
 */
export function splitOnDelimiter(raw: string): [summary: string, json: string] {
  const at = raw.indexOf(EVENTS_DELIMITER)
  if (at === -1) return ['', raw]
  return [raw.slice(0, at), raw.slice(at + EVENTS_DELIMITER.length)]
}

// ─── Extracted shape (matches what Claude returns) ──────────────────────────

interface ExtractedEvent {
  title: string
  date: string
  endDate?: string
  time?: string
  endTime?: string
  location?: string
  description?: string
  category: 'school' | 'activity' | 'medical' | 'social' | 'other'
  // Loosely typed: this comes straight from the model, so we sanitise it in
  // toCalendarEvent rather than trusting the shape.
  confidence?: { title?: string; datetime?: string; location?: string }
}

/** Coerce a model-supplied confidence value to a valid level. Missing or invalid
 *  input defaults to 'medium' — the honest fallback is to flag for a second look
 *  rather than falsely reassure with 'high'.
 *  Exported so the fallback contract can be unit-tested directly: this is the
 *  seam where untrusted model output becomes a value the UI trusts, and a
 *  regression here (e.g. defaulting to 'high') would silently mislead parents
 *  without any type error. */
export function sanitizeLevel(value: unknown): ConfidenceLevel {
  return value === 'high' || value === 'low' ? value : 'medium'
}

// ─── Mappers ────────────────────────────────────────────────────────────────

function formatDateDisplay(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number)
  return new Date(year, month - 1, day).toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

function formatTimeDisplay(time?: string, endTime?: string): string | null {
  if (!time) return null
  const fmt = (t: string) => {
    const [h, m] = t.split(':').map(Number)
    const ampm = h >= 12 ? 'PM' : 'AM'
    return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${ampm}`
  }
  return endTime ? `${fmt(time)} – ${fmt(endTime)}` : fmt(time)
}

function buildCalString(date: string, time?: string, endDate?: string, endTime?: string): string {
  const d = date.replace(/-/g, '')

  if (!time) {
    // All-day: end date is exclusive so advance by one day
    const end = endDate
      ? endDate.replace(/-/g, '')
      : (() => {
          const [y, mo, dy] = date.split('-').map(Number)
          const next = new Date(Date.UTC(y, mo - 1, dy + 1))
          return next.toISOString().split('T')[0].replace(/-/g, '')
        })()
    return `${d}/${end}`
  }

  const [sh, sm] = time.split(':')
  const hour = parseInt(sh ?? '', 10)
  const minute = parseInt(sm ?? '', 10)
  if (isNaN(hour) || isNaN(minute) || hour > 23 || minute > 59) {
    // Malformed time — fall back to all-day
    const end = endDate
      ? endDate.replace(/-/g, '')
      : (() => {
          const [y, mo, dy] = date.split('-').map(Number)
          return new Date(Date.UTC(y, mo - 1, dy + 1)).toISOString().split('T')[0].replace(/-/g, '')
        })()
    return `${d}/${end}`
  }

  const shPad = String(hour).padStart(2, '0')
  const smPad = String(minute).padStart(2, '0')
  // No Z suffix — floating local time so Google Calendar uses the user's timezone
  const start = `${d}T${shPad}${smPad}00`

  let end: string
  if (endTime) {
    const [esh, esm] = endTime.split(':')
    const endHourVal = parseInt(esh ?? '', 10)
    const endMinVal = parseInt(esm ?? '', 10)
    const ed = endDate ? endDate.replace(/-/g, '') : d
    if (isNaN(endHourVal) || isNaN(endMinVal) || endHourVal > 23 || endMinVal > 59) {
      // Malformed endTime — default to one hour after start, clamped to 23:59
      const fallbackEndHour = Math.min(hour + 1, 23)
      end = `${ed}T${String(fallbackEndHour).padStart(2, '0')}${hour >= 23 ? '59' : smPad}00`
    } else {
      end = `${ed}T${String(endHourVal).padStart(2, '0')}${String(endMinVal).padStart(2, '0')}00`
    }
  } else {
    // Clamp to 23:59 when start is at hour 23
    const endHourVal = Math.min(hour + 1, 23)
    end = `${d}T${String(endHourVal).padStart(2, '0')}${hour >= 23 ? '59' : smPad}00`
  }

  return `${start}/${end}`
}

function toCalendarEvent(event: ExtractedEvent, id: number): CalendarEvent {
  // Confidence is assessed by the model per field; we only sanitise it here.
  // Location confidence is included only when the event actually has a location.
  const confidence: EventConfidence = {
    title: sanitizeLevel(event.confidence?.title),
    datetime: sanitizeLevel(event.confidence?.datetime),
    ...(event.location ? { location: sanitizeLevel(event.confidence?.location) } : {}),
  }
  return {
    id,
    title: event.title,
    date: formatDateDisplay(event.date),
    time: formatTimeDisplay(event.time, event.endTime),
    location: event.location ?? null,
    notes: event.description ?? null,
    cal: buildCalString(event.date, event.time, event.endDate, event.endTime),
    confidence,
  }
}

// ─── Request building & parsing (shared by streaming and non-streaming) ───────

function buildContent(base64: string, mimeType: string): Anthropic.MessageParam['content'] {
  const isPdf = mimeType.includes('pdf')

  const validImageTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as const
  type ValidImageType = (typeof validImageTypes)[number]
  const safeImageType: ValidImageType = (validImageTypes as readonly string[]).includes(mimeType)
    ? (mimeType as ValidImageType)
    : 'image/jpeg'

  return isPdf
    ? [
        {
          type: 'document',
          source: { type: 'base64', media_type: 'application/pdf', data: base64 },
        } as Anthropic.Messages.DocumentBlockParam,
        { type: 'text', text: buildPrompt() },
      ]
    : [
        {
          type: 'image',
          source: { type: 'base64', media_type: safeImageType, data: base64 },
        },
        { type: 'text', text: buildPrompt() },
      ]
}

/**
 * Build the request content for a plain-text message. Same shape as
 * `buildContent` but the "document" is a text block instead of a file: the
 * letter text first, then the same `buildPrompt()` instruction, so the model
 * sees an identical task regardless of how the source arrived. Used by the
 * string-in entry point below.
 */
function buildTextContent(text: string): Anthropic.MessageParam['content'] {
  return [
    { type: 'text', text },
    { type: 'text', text: buildPrompt() },
  ]
}

/** Strip any markdown fences, parse the JSON array, and map to CalendarEvents. */
function parseAndMapEvents(jsonText: string): CalendarEvent[] {
  // Strip markdown code fences that the model sometimes adds despite the prompt
  const fenceMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)
  const text = (fenceMatch ? fenceMatch[1] : jsonText).trim()

  let extracted: ExtractedEvent[]
  try {
    extracted = JSON.parse(text) as ExtractedEvent[]
  } catch {
    throw new Error(`Claude returned invalid JSON: ${text.slice(0, 200)}`)
  }
  return extracted.map((e, i) => toCalendarEvent(e, i + 1))
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * The shared non-streaming core: one `messages.create` call, then split off the
 * summary and map the JSON payload to events. Both public non-streaming entry
 * points (`extractEventsFromFile`, `extractEventsFromText`) differ ONLY in how
 * they build the request `content` — the model, token budget, timeout, delimiter
 * split, and JSON parsing are identical, so they live here in one place. Keeping
 * this seam means the eval's string-in path exercises the exact same model call
 * and parsing the production upload path relies on.
 */
async function extractFromContent(
  content: Anthropic.MessageParam['content'],
): Promise<CalendarEvent[]> {
  const response = await getClient().messages.create(
    {
      model: MODEL,
      max_tokens: MAX_TOKENS,
      messages: [{ role: 'user', content }],
    },
    { timeout: 30_000 },
  )

  const raw = response.content[0].type === 'text' ? response.content[0].text : '[]'
  // Discard the summary half; only the JSON payload is mapped to events.
  const [, jsonPart] = splitOnDelimiter(raw)
  return parseAndMapEvents(jsonPart)
}

/**
 * Extract calendar events from a base64-encoded file using Claude (non-streaming).
 * Throws on API errors; returns an empty array when no events are found.
 * Retained for callers/tests that want the whole result in one call; the upload
 * route uses `streamEventsFromFile` instead.
 *
 * Unchanged in behaviour by the phase-two refactor: it still owns file → content
 * translation, and delegates the model call + parsing to `extractFromContent`.
 */
export async function extractEventsFromFile(
  base64: string,
  mimeType: string,
): Promise<CalendarEvent[]> {
  return extractFromContent(buildContent(base64, mimeType))
}

/**
 * Extract calendar events from a raw text string using Claude (non-streaming).
 *
 * WHY THIS EXISTS: the AI eval harness feeds each fixture's `sourceLetter` — a
 * plain string — to the live model. The only non-streaming entry point before
 * this was file-oriented, so the eval would have had to base64-encode strings
 * into fake "files" just to reach the pipeline. That ceremony obscured the thing
 * actually under test (does the model extract the right events from this text?)
 * and coupled the eval to the file/mime plumbing. A string-in variant makes the
 * eval read as what it is. It shares the model call and parsing with the
 * file path via `extractFromContent`, so the two can never drift apart.
 */
export async function extractEventsFromText(text: string): Promise<CalendarEvent[]> {
  return extractFromContent(buildTextContent(text))
}

/**
 * A chunk emitted by `streamEventsFromFile`:
 *  - `summary_delta` — a slice of the human-readable summary as it streams in.
 *  - `result`        — the terminal frame: the full summary plus the parsed,
 *                      mapped events, produced only once the whole response has
 *                      arrived.
 */
export type StreamChunk =
  | { type: 'summary_delta'; text: string }
  | { type: 'result'; summary: string; events: CalendarEvent[] }

/**
 * Stream a file through Claude, yielding the human-readable summary progressively
 * and the structured events only once complete.
 *
 * Why the split: the summary is safe to show as it arrives, but the events are
 * *actionable* (a parent adds them to their calendar). We must never surface a
 * half-formed event, so we forward summary text live while buffering everything
 * after the delimiter, then parse the JSON in one go and emit the events as a
 * single terminal `result` chunk. The client never sees partial JSON.
 */
export async function* streamEventsFromFile(
  base64: string,
  mimeType: string,
): AsyncGenerator<StreamChunk> {
  const stream = getClient().messages.stream(
    {
      model: MODEL,
      max_tokens: MAX_TOKENS,
      messages: [{ role: 'user', content: buildContent(base64, mimeType) }],
    },
    { timeout: 30_000 },
  )

  // We rebuild the model's output incrementally in `full` and forward only the
  // part we're sure is summary. `emitted` tracks how much summary we've already
  // sent so each yield carries just the newly-revealed slice.
  let full = '' // everything the model has emitted so far
  let emitted = 0 // how many chars of summary we've already forwarded
  let sawDelimiter = false

  for await (const event of stream) {
    // The SDK stream emits many event kinds; we only care about text deltas.
    if (event.type !== 'content_block_delta' || event.delta.type !== 'text_delta') continue
    full += event.delta.text

    // Once the delimiter is seen, all further text is JSON — buffer it silently.
    if (sawDelimiter) continue

    const at = full.indexOf(EVENTS_DELIMITER)
    if (at !== -1) sawDelimiter = true

    // The tricky bit: tokens arrive in arbitrary chunks, so the delimiter can be
    // split across two of them. If we naively forwarded every char, a chunk
    // ending in "…summary<<<EVE" would leak "<<<EVE" (a delimiter fragment) into
    // the summary. So while we haven't seen the full delimiter yet, we hold back
    // its last (length - 1) chars — the most that could be an incomplete
    // delimiter — and only emit what's provably safe.
    //
    // Worked example (delimiter length 17):
    //   chunk 1 = "Hi.\n<<<EVE"          → no delimiter yet, hold back 16 chars,
    //                                       emit "Hi.\n"… wait, only 10 chars so
    //                                       nothing certain yet → emit ""
    //   chunk 2 = "NTS_JSON>>>\n[]"      → full = "Hi.\n<<<EVENTS_JSON>>>\n[]",
    //                                       delimiter found at index 4 → emit
    //                                       "Hi.\n" and stop. No fragment leaks.
    const safeEnd = sawDelimiter
      ? at // emit up to the delimiter
      : Math.max(emitted, full.length - (EVENTS_DELIMITER.length - 1))
    if (safeEnd > emitted) {
      yield { type: 'summary_delta', text: full.slice(emitted, safeEnd) }
      emitted = safeEnd
    }
  }

  // Stream finished: split, parse, and hand back the complete result atomically.
  const [summary, jsonPart] = splitOnDelimiter(full)
  yield { type: 'result', summary: summary.trim(), events: parseAndMapEvents(jsonPart) }
}
