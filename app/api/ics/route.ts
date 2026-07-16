/**
 * GET /api/ics — download an iCalendar (.ics) file for the Apple Calendar path.
 * ────────────────────────────────────────────────────────────────────────────
 * The results screen encodes the selected events into `?e=<base64url(JSON)>`
 * (see lib/ics.ts `encodeEvents`). We decode, build the VCALENDAR, and return it
 * as an attachment. Serving it as a real `text/calendar` response — rather than a
 * client-side blob download — is what reliably triggers iOS Safari's native
 * "Add to Calendar" sheet.
 *
 * The events carry no secrets (they're already on the client), so there's no
 * auth here — just strict validation so a crafted URL can't make us emit a huge
 * or malformed response. Bad input → 400, never a 500.
 */

import type { NextRequest } from 'next/server'
import { buildIcs, decodeEvents } from '@/lib/ics'

// Never cache: the .ics is derived entirely from the query string and is cheap
// to regenerate; caching would only risk stale content across shared proxies.
export const dynamic = 'force-dynamic'

// Rough ceiling on the encoded payload so we don't parse absurd query strings.
const MAX_PAYLOAD_LENGTH = 16_000

export function GET(req: NextRequest) {
  const payload = req.nextUrl.searchParams.get('e')
  if (!payload || payload.length > MAX_PAYLOAD_LENGTH) {
    return new Response('Invalid request', { status: 400 })
  }

  const events = decodeEvents(payload)
  if (!events) {
    return new Response('Invalid request', { status: 400 })
  }

  // ICS UTC timestamp for DTSTAMP, e.g. "20250709T120000Z".
  const dtstamp = new Date()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '')

  const ics = buildIcs(events, dtstamp)
  if (!ics) {
    return new Response('Invalid request', { status: 400 })
  }

  return new Response(ics, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'attachment; filename="familybrief.ics"',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
