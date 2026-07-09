export type Screen = 'upload' | 'processing' | 'results' | 'error'

/** Three-level, model-assessed confidence. `high` reads as the default; `medium`
 *  and `low` are flagged in the UI as needing a second look. */
export type ConfidenceLevel = 'high' | 'medium' | 'low'

/** Per-field confidence — a parent relies on the event title, the date/time, and
 *  the location independently, so each is assessed on its own. `location` is only
 *  present when the event actually has a location. */
export interface EventConfidence {
  title: ConfidenceLevel
  datetime: ConfidenceLevel
  location?: ConfidenceLevel
}

export interface CalendarEvent {
  id: number
  title: string
  date: string
  time: string | null
  location: string | null
  notes: string | null
  /** Google Calendar date range. Timed: "YYYYMMDDTHHmmss/YYYYMMDDTHHmmss" (floating local time). All-day: "YYYYMMDD/YYYYMMDD". */
  cal: string
  confidence: EventConfidence
}
