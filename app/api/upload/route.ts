/**
 * POST /api/upload — the streaming server endpoint (Next.js App Router handler).
 * ────────────────────────────────────────────────────────────────────────────
 * Lifecycle of one request:
 *   1. Rate-limit + validate the file. These can still REJECT the request, so
 *      they return ordinary JSON with a 4xx status (429/415/413/400).
 *   2. Success → we return a streaming Response (a ReadableStream) whose body is
 *      Server-Sent Events. Once we do this the HTTP status is locked to 200 —
 *      headers are flushed before the first byte — so no check that could reject
 *      the request may run after this point. That's why step 1 is exhaustive.
 *
 * The SSE contract the client (ScreenRouter) reads:
 *   event: delta  data: {"text": "<summary chunk>"}          (0..n of these)
 *   event: done   data: {"summary": "...", "events": [...]}  (terminal success)
 *   event: error  data: {"message": "<sanitized>"}           (terminal failure)
 *
 * Because the status is already 200 once streaming starts, a mid-stream failure
 * can't become a 500 — it's delivered as an in-band `error` event instead, with
 * a generic message so raw SDK errors never leak to the client.
 */

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { isAcceptedType, MAX_FILE_SIZE_BYTES, validateMagicBytes } from '@/lib/file-config'
import { streamEventsFromFile } from '@/lib/extract-events'

// ─── Rate limiting ────────────────────────────────────────────────────────────

const RATE_LIMIT_MAX = 5
const RATE_LIMIT_WINDOW_MS = 60 * 1000 // 60 seconds

const rateLimitMap = new Map<string, number[]>()

// Exposed for tests so per-suite isolation doesn't require module re-loading.
export function clearRateLimitState() {
  rateLimitMap.clear()
}

function isRateLimited(ip: string): boolean {
  const now = Date.now()
  const timestamps = (rateLimitMap.get(ip) ?? []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS)
  // Always write back the pruned list so stale entries don't accumulate in the map.
  rateLimitMap.set(ip, timestamps)
  if (timestamps.length >= RATE_LIMIT_MAX) return true
  timestamps.push(now)
  return false
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  // Auth gate. Runs FIRST — before rate-limiting, before validation. The proxy
  // catches the common "no cookie" case cheaply; this is the authoritative
  // check against the sessions table. Anonymous requests get 401 with a plain
  // text body (matches the sanitized error style used elsewhere in this route
  // and avoids leaking session shape via a JSON body).
  const session = await auth()
  if (!session?.user) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  // Use the rightmost x-forwarded-for entry — Vercel appends the connecting IP
  // there, so it cannot be spoofed by a client prepending fake IPs.
  const forwarded = req.headers.get('x-forwarded-for')
  const ip =
    (forwarded ? forwarded.split(',').at(-1)?.trim() : null) ??
    req.headers.get('x-real-ip') ??
    'unknown'

  if (isRateLimited(ip)) {
    return NextResponse.json(
      { ok: false, error: 'Too many requests. Please wait a moment.' },
      { status: 429 },
    )
  }

  const formData = await req.formData()
  const file = formData.get('file')

  if (!(file instanceof File)) {
    return NextResponse.json({ ok: false, error: 'No file received' }, { status: 400 })
  }
  if (!isAcceptedType(file)) {
    return NextResponse.json({ ok: false, error: 'Unsupported file type' }, { status: 415 })
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return NextResponse.json({ ok: false, error: 'File too large (max 20 MB)' }, { status: 413 })
  }
  if (!(await validateMagicBytes(file))) {
    return NextResponse.json(
      { ok: false, error: 'File content does not match its type' },
      { status: 415 },
    )
  }

  // All validation and rate-limiting above returns plain JSON with the right
  // status code. Once we commit to streaming below, the status is locked to 200
  // (headers are sent before the first byte), so every check that could reject
  // the request must happen here, before the ReadableStream is created.
  const bytes = await file.arrayBuffer()
  const base64 = Buffer.from(bytes).toString('base64')

  const encoder = new TextEncoder()
  const sse = (event: string, data: unknown) =>
    encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        // Forward the summary as it streams; the terminal `result` carries the
        // fully parsed events. See streamEventsFromFile for why events are held.
        for await (const chunk of streamEventsFromFile(base64, file.type)) {
          if (chunk.type === 'summary_delta') {
            controller.enqueue(sse('delta', { text: chunk.text }))
          } else if (chunk.type === 'status') {
            // New in the two-panel work: forward agent-stage transitions as their
            // own SSE event. Purely additive — clients that don't know `status`
            // ignore it, and the `delta`/`done`/`error` contract is unchanged.
            controller.enqueue(sse('status', { stage: chunk.stage }))
          } else {
            controller.enqueue(sse('done', { summary: chunk.summary, events: chunk.events }))
          }
        }
      } catch (err) {
        // The 200 + headers are already committed, so we can't switch to a 500.
        // Deliver a *sanitized* error in-band (never leak SDK error text) and let
        // the client surface a recoverable error state.
        console.error('[upload] streaming extraction failed:', err)
        controller.enqueue(sse('error', { message: 'Extraction failed. Please try again.' }))
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Content-Type-Options': 'nosniff',
      // Disable proxy/CDN buffering so summary deltas flush to the client live.
      'X-Accel-Buffering': 'no',
    },
  })
}
