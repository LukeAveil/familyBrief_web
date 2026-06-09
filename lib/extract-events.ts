import Anthropic from '@anthropic-ai/sdk'
import type { CalendarEvent } from '@/types'

const MODEL = 'claude-sonnet-4-6'

// Lazy client — created on first use so importing this module never throws
// even when ANTHROPIC_API_KEY is absent (e.g. in tests that mock the SDK).
let _client: Anthropic | null = null
const getClient = () => {
  if (!_client) _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  return _client
}

// ─── Prompt ────────────────────────────────────────────────────────────────

function buildPrompt(): string {
  const today = new Date().toISOString().split('T')[0]
  return `You are a helpful assistant that extracts calendar events from school letters, newsletters, and activity schedules for parents.

Look at this document and extract ALL events, deadlines, and important dates.

Today's date is ${today}.

For each event found, extract:
- title: clear, concise event name
- date: YYYY-MM-DD format (infer the year if not shown — use next upcoming)
- endDate: YYYY-MM-DD if multi-day (optional)
- time: HH:MM in 24hr format (optional)
- endTime: HH:MM in 24hr format (optional)
- location: where it takes place (optional)
- description: any important details parents need to know (optional)
- category: one of school|activity|medical|social|other

Respond ONLY with a valid JSON array. No preamble, no explanation.
If no events are found, return an empty array [].`
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
  const start = `${d}T${sh}${sm}00Z`

  let end: string
  if (endTime) {
    const [eh, em] = endTime.split(':')
    const ed = endDate ? endDate.replace(/-/g, '') : d
    end = `${ed}T${eh}${em}00Z`
  } else {
    const endHour = String(parseInt(sh) + 1).padStart(2, '0')
    end = `${d}T${endHour}${sm}00Z`
  }

  return `${start}/${end}`
}

function toCalendarEvent(event: ExtractedEvent, id: number): CalendarEvent {
  return {
    id,
    title: event.title,
    date: formatDateDisplay(event.date),
    time: formatTimeDisplay(event.time, event.endTime),
    location: event.location ?? null,
    notes: event.description ?? null,
    cal: buildCalString(event.date, event.time, event.endDate, event.endTime),
    confidence: 'high',
  }
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Extract calendar events from a base64-encoded file using Claude.
 * Throws on API errors; returns an empty array when no events are found.
 */
export async function extractEventsFromFile(
  base64: string,
  mimeType: string,
): Promise<CalendarEvent[]> {
  const isPdf = mimeType.includes('pdf')

  const validImageTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as const
  type ValidImageType = (typeof validImageTypes)[number]
  const safeImageType: ValidImageType = (validImageTypes as readonly string[]).includes(mimeType)
    ? (mimeType as ValidImageType)
    : 'image/jpeg'

  const content: Anthropic.MessageParam['content'] = isPdf
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

  const response = await getClient().messages.create({
    model: MODEL,
    max_tokens: 1024,
    messages: [{ role: 'user', content }],
  })

  const raw = response.content[0].type === 'text' ? response.content[0].text : '[]'
  // Strip markdown code fences that the model sometimes adds despite the prompt
  const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)
  const text = (fenceMatch ? fenceMatch[1] : raw).trim()

  const extracted = JSON.parse(text) as ExtractedEvent[]
  return extracted.map((e, i) => toCalendarEvent(e, i + 1))
}
