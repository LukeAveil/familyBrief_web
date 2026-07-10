import type { CalendarEvent } from '@/types'

export const MOCK_SINGLE: CalendarEvent[] = [
  {
    id: 1,
    title: 'Year 4 Sports Day',
    date: 'Thursday, 26 June 2025',
    time: '9:30 AM – 12:00 PM',
    location: 'School Playing Fields',
    notes: 'Children should wear their PE kit. Parents are welcome to watch from the spectator area.',
    cal: '20250626T093000Z/20250626T120000Z',
    confidence: { title: 'high', datetime: 'high', location: 'high' },
  },
]

export const MOCK_MULTIPLE: CalendarEvent[] = [
  {
    id: 1,
    title: 'Year 4 Sports Day',
    date: 'Thursday, 26 June 2025',
    time: '9:30 AM – 12:00 PM',
    location: 'School Playing Fields',
    notes: 'Children should wear their PE kit.',
    cal: '20250626T093000Z/20250626T120000Z',
    confidence: { title: 'high', datetime: 'high', location: 'high' },
  },
  {
    id: 2,
    title: 'End of Year Performance',
    date: 'Tuesday, 15 July 2025',
    time: '6:00 PM',
    location: 'School Hall',
    notes: 'Two performances at 6pm and 7:30pm. Tickets available from the school office.',
    cal: '20250715T180000Z/20250715T200000Z',
    // Two performance times mentioned — the specific start is inferred.
    confidence: { title: 'high', datetime: 'medium', location: 'high' },
  },
  {
    id: 3,
    title: 'Last Day of Term',
    date: 'Friday, 18 July 2025',
    time: 'School finishes at 1:00 PM',
    location: null,
    notes: null,
    cal: '20250718T130000Z/20250718T130000Z',
    // Date stated with no year; no venue given at all.
    confidence: { title: 'high', datetime: 'medium' },
  },
  {
    id: 4,
    title: 'Parents’ Evening (provisional)',
    date: 'Wednesday, 23 July 2025',
    time: null,
    location: 'Main Reception',
    notes: 'Date referred to only as "the last Wednesday" — please confirm with the school.',
    cal: '20250723/20250724',
    // "the last Wednesday" resolved from context, and the event name is a guess.
    confidence: { title: 'low', datetime: 'low', location: 'medium' },
  },
]
