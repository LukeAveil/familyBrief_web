/**
 * iCalendar (.ics) generation — the Apple Calendar / iCloud path.
 * ────────────────────────────────────────────────────────────────────────────
 * Many iOS parents don't use Google Calendar, so alongside the Google deep-link
 * we offer a downloadable `.ics` file. Opening it on iOS pops the native
 * "Add to Calendar" sheet; it also imports into Outlook, Fantastical, etc.
 *
 * No new date logic: the existing `CalendarEvent.cal` field already holds exactly
 * what ICS needs. `buildCalString` (lib/extract-events.ts) produces:
 *   - Timed:   "YYYYMMDDTHHmmss/YYYYMMDDTHHmmss"  — floating local time (no Z),
 *              a valid ICS floating DTSTART/DTEND.
 *   - All-day: "YYYYMMDD/YYYYMMDD"                — DTSTART;VALUE=DATE / DTEND;VALUE=DATE,
 *              end already stored exclusive (as ICS wants).
 * We just reshape `cal` into VEVENT properties.
 *
 * Flow: ResultsScreen builds `/api/ics?e=<encodeEvents(...)>` → app/api/ics
 *       route decodes and calls buildIcs → browser downloads the .ics.
 */

import type { CalendarEvent } from '@/types'

/** The minimal fields the ICS file needs — the shape shared over the URL. */
export interface IcsEvent {
  id: number
  title: string
  /** Same format as CalendarEvent.cal — "start/end", timed or all-day. */
  cal: string
  location: string | null
  notes: string | null
}

/** Upper bound on events per file — a defensive cap so a crafted URL can't ask
 *  us to generate an unbounded response. Real letters have a handful of events. */
export const MAX_ICS_EVENTS = 50

// ─── Encoding for the URL (base64url of JSON) ────────────────────────────────

function toBase64Url(s: string): string {
  const b64 = Buffer.from(s, 'utf-8').toString('base64')
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(s: string): string {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/')
  return Buffer.from(b64, 'base64').toString('utf-8')
}

/** Narrow the full event to the fields we ship, keeping the payload compact. */
function pick(ev: CalendarEvent | IcsEvent): IcsEvent {
  return { id: ev.id, title: ev.title, cal: ev.cal, location: ev.location, notes: ev.notes }
}

/** Encode events into a URL-safe query-param string. */
export function encodeEvents(events: (CalendarEvent | IcsEvent)[]): string {
  return toBase64Url(JSON.stringify(events.map(pick)))
}

/**
 * Decode the query-param payload back into events. Returns null on any malformed
 * or out-of-bounds input so the route can answer a clean 400 rather than throw.
 */
export function decodeEvents(payload: string): IcsEvent[] | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(fromBase64Url(payload))
  } catch {
    return null
  }
  if (!Array.isArray(parsed) || parsed.length === 0 || parsed.length > MAX_ICS_EVENTS) return null

  const out: IcsEvent[] = []
  for (const item of parsed) {
    if (!item || typeof item !== 'object') return null
    const e = item as Record<string, unknown>
    if (typeof e.id !== 'number' || typeof e.title !== 'string' || typeof e.cal !== 'string')
      return null
    // cal must look like "start/end" — validated more strictly when we build the VEVENT.
    if (!e.cal.includes('/')) return null
    out.push({
      id: e.id,
      title: e.title,
      cal: e.cal,
      location: typeof e.location === 'string' ? e.location : null,
      notes: typeof e.notes === 'string' ? e.notes : null,
    })
  }
  return out
}

// ─── ICS building ─────────────────────────────────────────────────────────────

/** Escape a text value per RFC 5545 §3.3.11 (backslash, semicolon, comma, newline). */
function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\n|\r/g, '\\n')
}

/**
 * Turn one "start/end" half from `cal` into an ICS date-time property.
 * A half containing "T" is timed; otherwise it's an all-day date. We tolerate a
 * trailing "Z" (mock data uses UTC) and keep it — a valid ICS UTC marker.
 * Returns e.g. `DTSTART:20250626T093000` or `DTSTART;VALUE=DATE:20250626`.
 * Returns null if the half isn't a recognisable date/time.
 */
function dateProp(name: 'DTSTART' | 'DTEND', half: string): string | null {
  if (/^\d{8}T\d{6}Z?$/.test(half)) return `${name}:${half}`
  if (/^\d{8}$/.test(half)) return `${name};VALUE=DATE:${half}`
  return null
}

/**
 * Fold a content line to <=75 octets per RFC 5545 §3.1. We approximate by
 * character count (event text is ASCII/short in practice); continuation lines
 * start with a single space.
 */
function foldLine(line: string): string {
  if (line.length <= 75) return line
  const chunks: string[] = []
  let rest = line
  chunks.push(rest.slice(0, 75))
  rest = rest.slice(75)
  while (rest.length > 74) {
    chunks.push(' ' + rest.slice(0, 74))
    rest = rest.slice(74)
  }
  if (rest.length) chunks.push(' ' + rest)
  return chunks.join('\r\n')
}

/**
 * Build a VCALENDAR document with one VEVENT per event. `dtstamp` (an ICS UTC
 * timestamp like "20250709T120000Z") is passed in so the module stays pure and
 * deterministic — the route supplies the request time.
 *
 * Events whose `cal` can't be parsed are skipped. Returns null if that leaves
 * no events at all, so callers can surface an error rather than emit an empty
 * calendar.
 */
export function buildIcs(events: IcsEvent[], dtstamp: string): string | null {
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//FamilyBrief//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ]

  let count = 0
  for (const ev of events) {
    const [start, end] = ev.cal.split('/')
    const startProp = start ? dateProp('DTSTART', start) : null
    const endProp = end ? dateProp('DTEND', end) : null
    if (!startProp || !endProp) continue // skip malformed events rather than emit a broken VEVENT

    lines.push('BEGIN:VEVENT')
    lines.push(`UID:${ev.id}-${ev.cal.replace(/\//g, '-')}@familybrief`)
    lines.push(`DTSTAMP:${dtstamp}`)
    lines.push(startProp)
    lines.push(endProp)
    lines.push(`SUMMARY:${escapeText(ev.title)}`)
    if (ev.location) lines.push(`LOCATION:${escapeText(ev.location)}`)
    if (ev.notes) lines.push(`DESCRIPTION:${escapeText(ev.notes)}`)
    lines.push('END:VEVENT')
    count++
  }

  if (count === 0) return null

  lines.push('END:VCALENDAR')
  return lines.map(foldLine).join('\r\n') + '\r\n'
}
