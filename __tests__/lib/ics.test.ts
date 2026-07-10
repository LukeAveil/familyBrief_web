/**
 * @jest-environment node
 */

import { buildIcs, encodeEvents, decodeEvents, MAX_ICS_EVENTS, type IcsEvent } from '@/lib/ics'
import type { CalendarEvent } from '@/types'

const DTSTAMP = '20250709T120000Z'

const timed: IcsEvent = {
  id: 1,
  title: 'Sports Day',
  cal: '20250626T093000/20250626T120000',
  location: 'School Field',
  notes: 'Bring a hat',
}

const allDay: IcsEvent = {
  id: 2,
  title: 'Half Term',
  cal: '20250728/20250802',
  location: null,
  notes: null,
}

describe('buildIcs', () => {
  it('emits a timed VEVENT with floating DTSTART/DTEND', () => {
    const ics = buildIcs([timed], DTSTAMP)!
    expect(ics).toContain('BEGIN:VCALENDAR')
    expect(ics).toContain('BEGIN:VEVENT')
    expect(ics).toContain('DTSTART:20250626T093000')
    expect(ics).toContain('DTEND:20250626T120000')
    expect(ics).toContain('SUMMARY:Sports Day')
    expect(ics).toContain('LOCATION:School Field')
    expect(ics).toContain('DESCRIPTION:Bring a hat')
    expect(ics).toContain(`DTSTAMP:${DTSTAMP}`)
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true)
  })

  it('emits an all-day VEVENT with VALUE=DATE and omits absent fields', () => {
    const ics = buildIcs([allDay], DTSTAMP)!
    expect(ics).toContain('DTSTART;VALUE=DATE:20250728')
    expect(ics).toContain('DTEND;VALUE=DATE:20250802')
    expect(ics).not.toContain('LOCATION:')
    expect(ics).not.toContain('DESCRIPTION:')
  })

  it('uses CRLF line endings', () => {
    const ics = buildIcs([timed], DTSTAMP)!
    expect(ics).toContain('\r\n')
    expect(ics.split('\r\n').length).toBeGreaterThan(5)
  })

  it('bundles multiple events into one calendar', () => {
    const ics = buildIcs([timed, allDay], DTSTAMP)!
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(2)
  })

  it('tolerates a trailing Z (UTC, as mock data uses)', () => {
    const ics = buildIcs([{ ...timed, cal: '20250626T093000Z/20250626T120000Z' }], DTSTAMP)!
    expect(ics).toContain('DTSTART:20250626T093000Z')
  })

  it('escapes special characters per RFC 5545', () => {
    const ics = buildIcs([{ ...timed, title: 'Cake; sale, fun\\joy', notes: 'line1\nline2' }], DTSTAMP)!
    expect(ics).toContain('SUMMARY:Cake\\; sale\\, fun\\\\joy')
    expect(ics).toContain('DESCRIPTION:line1\\nline2')
  })

  it('skips events with an unparseable cal and returns null when none survive', () => {
    expect(buildIcs([{ ...timed, cal: 'not-a-date/also-bad' }], DTSTAMP)).toBeNull()
    // A good event alongside a bad one keeps only the good one.
    const ics = buildIcs([timed, { ...allDay, cal: 'bogus' }], DTSTAMP)!
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(1)
  })
})

describe('encodeEvents / decodeEvents', () => {
  const full: CalendarEvent = {
    id: 3,
    title: 'Parents Evening',
    date: 'Thursday, 26 June 2025',
    time: '5:00 PM – 7:00 PM',
    location: 'Main Hall',
    notes: 'Book a slot',
    cal: '20250626T170000/20250626T190000',
    confidence: 'high',
  }

  it('round-trips the minimal fields', () => {
    const decoded = decodeEvents(encodeEvents([full]))
    expect(decoded).toEqual([
      { id: 3, title: 'Parents Evening', cal: full.cal, location: 'Main Hall', notes: 'Book a slot' },
    ])
  })

  it('produces a URL-safe payload (no +, /, or =)', () => {
    const payload = encodeEvents([full])
    expect(payload).not.toMatch(/[+/=]/)
  })

  it('rejects malformed base64/JSON', () => {
    expect(decodeEvents('!!!not-valid!!!')).toBeNull()
    expect(decodeEvents(Buffer.from('{bad json').toString('base64url'))).toBeNull()
  })

  it('rejects an empty array', () => {
    expect(decodeEvents(encodeEvents([]))).toBeNull()
  })

  it('rejects more than MAX_ICS_EVENTS', () => {
    const many = Array.from({ length: MAX_ICS_EVENTS + 1 }, (_, i) => ({ ...full, id: i }))
    expect(decodeEvents(encodeEvents(many))).toBeNull()
  })

  it('rejects entries missing required fields or a cal separator', () => {
    expect(decodeEvents(Buffer.from(JSON.stringify([{ id: 1, title: 'x' }]), 'utf-8').toString('base64url'))).toBeNull()
    expect(decodeEvents(encodeEvents([{ ...full, cal: 'no-separator' }]))).toBeNull()
  })
})
