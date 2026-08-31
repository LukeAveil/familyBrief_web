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
 * can't become a 500 — it's delivered as an in-band `error` event instead. The
 * message is either one we authored (truncation, which names a real limit the
 * parent can act on) or a generic fallback, so raw SDK text never reaches the
 * client. It does reach the server log; see lib/log.
 *
 * Every exit path — including the 4xx rejections — emits one structured log line
 * carrying Vercel's request ID, so a dashboard entry can be traced to its cause.
 */

import { NextRequest, NextResponse } from 'next/server'
import {
  isAcceptedType,
  MAX_FILE_SIZE_BYTES,
  MAX_FILE_SIZE_LABEL,
  validateMagicBytes,
} from '@/lib/file-config'
import { streamEventsFromFile, TruncatedExtractionError } from '@/lib/extract-events'
import { createLogger, requestId } from '@/lib/log'

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
  const log = createLogger('upload', requestId(req.headers))
  const startedAt = Date.now()

  // Every rejection goes through here so none can return silently — the reason a
  // failed upload used to show up in the dashboard as a bare status code with
  // nothing behind it. `reason` is a stable machine-readable slug (filterable in
  // the log drain); `error` is the human copy the client will now surface.
  const reject = (reason: string, status: number, error: string, fields = {}) => {
    log('error', 'rejected', { reason, status, ...fields })
    return NextResponse.json({ ok: false, error }, { status })
  }

  // Use the rightmost x-forwarded-for entry — Vercel appends the connecting IP
  // there, so it cannot be spoofed by a client prepending fake IPs.
  const forwarded = req.headers.get('x-forwarded-for')
  const ip =
    (forwarded ? forwarded.split(',').at(-1)?.trim() : null) ??
    req.headers.get('x-real-ip') ??
    'unknown'

  if (isRateLimited(ip)) {
    return reject('rate_limit', 429, 'Too many requests. Please wait a moment.')
  }

  const formData = await req.formData()
  const file = formData.get('file')

  if (!(file instanceof File)) {
    return reject('no_file', 400, 'No file received')
  }

  // Shape only — never the filename, which routinely names a child. See lib/log.
  const meta = { size: file.size, mime: file.type }

  if (!isAcceptedType(file)) {
    return reject('bad_type', 415, 'Unsupported file type', meta)
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return reject('too_large', 413, `File too large (max ${MAX_FILE_SIZE_LABEL})`, meta)
  }
  if (!(await validateMagicBytes(file))) {
    return reject('magic_bytes', 415, 'File content does not match its type', meta)
  }

  log('log', 'started', meta)

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
            // Log the token spend on EVERY success, not just on failure. This is
            // what turns "are we near the ceiling?" into a dashboard query — the
            // original truncation bug would have been one glance at an
            // outputTokens that had flatlined at the max.
            log('log', 'completed', {
              eventCount: chunk.events.length,
              stopReason: chunk.stopReason,
              outputTokens: chunk.outputTokens,
              durationMs: Date.now() - startedAt,
            })
            // Diagnostics stay server-side; the SSE contract is unchanged.
            controller.enqueue(sse('done', { summary: chunk.summary, events: chunk.events }))
          }
        }
      } catch (err) {
        // The 200 + headers are already committed, so we can't switch to a 500.
        // Deliver the error in-band and let the client surface a recoverable state.
        const durationMs = Date.now() - startedAt

        // Truncation is the one failure with a message worth showing: we wrote it,
        // it names a real limit, and it tells the parent what to do about it. Every
        // other error stays generic so raw SDK text can never reach the client.
        if (err instanceof TruncatedExtractionError) {
          log('error', 'truncated', { durationMs })
          controller.enqueue(
            sse('error', {
              message:
                'That letter has more events than we could read in one go. Try splitting it into two uploads.',
            }),
          )
        } else {
          log('error', 'failed', {
            message: err instanceof Error ? err.message : String(err),
            durationMs,
          })
          controller.enqueue(sse('error', { message: 'Extraction failed. Please try again.' }))
        }
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
