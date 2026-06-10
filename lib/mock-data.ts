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
    confidence: 'high',
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
    confidence: 'high',
  },
  {
    id: 2,
    title: 'End of Year Performance',
    date: 'Tuesday, 15 July 2025',
    time: '6:00 PM',
    location: 'School Hall',
    notes: 'Two performances at 6pm and 7:30pm. Tickets available from the school office.',
    cal: '20250715T180000Z/20250715T200000Z',
    confidence: 'high',
  },
  {
    id: 3,
    title: 'Last Day of Term',
    date: 'Friday, 18 July 2025',
    time: 'School finishes at 1:00 PM',
    location: null,
    notes: null,
    cal: '20250718T130000Z/20250718T130000Z',
    confidence: 'medium',
  },
]
