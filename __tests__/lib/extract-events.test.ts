/**
 * @jest-environment node
 */

const mockCreate = jest.fn()

jest.mock('@anthropic-ai/sdk', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    messages: { create: mockCreate },
  })),
}))

import { extractEventsFromFile } from '@/lib/extract-events'

function mockResponse(text: string) {
  mockCreate.mockResolvedValueOnce({
    content: [{ type: 'text', text }],
    usage: { input_tokens: 10, output_tokens: 20 },
    stop_reason: 'end_turn',
  })
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
    mockResponse(JSON.stringify([{
      title: 'Sports Day',
      date: '2025-06-26',
      time: '09:30',
      endTime: '12:00',
      location: 'Playing Fields',
      description: 'Wear PE kit',
      category: 'school',
    }]))

    const [event] = await extractEventsFromFile('base64data', 'application/pdf')
    expect(event.id).toBe(1)
    expect(event.title).toBe('Sports Day')
    expect(event.date).toContain('2025')
    expect(event.time).toBe('9:30 AM – 12:00 PM')
    expect(event.location).toBe('Playing Fields')
    expect(event.notes).toBe('Wear PE kit')
    expect(event.confidence).toBe('high')
  })

  it('assigns sequential ids starting from 1', async () => {
    mockResponse(JSON.stringify([
      { title: 'Event A', date: '2025-06-01', category: 'school' },
      { title: 'Event B', date: '2025-06-02', category: 'school' },
    ]))
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
    mockResponse(JSON.stringify([{
      title: 'Event',
      date: '2025-06-26',
      time: '09:30',
      endTime: '12:00',
      category: 'school',
    }]))
    const [event] = await extractEventsFromFile('base64data', 'application/pdf')
    expect(event.cal).toBe('20250626T093000/20250626T120000')
  })

  it('throws when the Anthropic API call fails', async () => {
    mockCreate.mockRejectedValueOnce(new Error('rate limited'))
    await expect(extractEventsFromFile('base64data', 'application/pdf'))
      .rejects.toThrow('rate limited')
  })
})
