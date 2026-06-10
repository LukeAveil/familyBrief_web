export type Screen = 'upload' | 'processing' | 'results' | 'error'
export type LayoutStyle = 'focus' | 'structured' | 'airy'
export type ResultsView = 'cards' | 'compact'
export type Confidence = 'high' | 'medium'

export interface CalendarEvent {
  id: number
  title: string
  date: string
  time: string | null
  location: string | null
  notes: string | null
  /** Google Calendar date range. Timed: "YYYYMMDDTHHmmss/YYYYMMDDTHHmmss" (floating local time). All-day: "YYYYMMDD/YYYYMMDD". */
  cal: string
  confidence: Confidence
}
