'use client'

/**
 * ScreenRouter — the client orchestrator and the consumer end of the stream.
 * ────────────────────────────────────────────────────────────────────────────
 * It owns the whole upload→result journey: which screen is showing, the fetch to
 * /api/upload, reading the Server-Sent Events off the response body, and the
 * error/cancellation/cleanup handling around that stream.
 *
 * Reading a stream in the browser:
 *   fetch() resolves as soon as the HEADERS arrive — the body is still flowing.
 *   res.body is a ReadableStream; res.body.getReader() lets us pull it chunk by
 *   chunk. Each chunk is raw bytes, so we decode to text, buffer it, and split
 *   off complete SSE frames (frames are separated by a blank line). We append
 *   summary `delta`s to state as they arrive (the live typing effect) and act on
 *   the terminal `done` / `error` frame.
 *
 * Three things this component is deliberately careful about — the patterns worth
 * studying here:
 *   • Cancellation — an AbortController per request; starting a new upload aborts
 *     the previous one, and an AbortError is treated as normal, not an error.
 *   • Cleanup on unmount — abort the stream and stop touching state (mountedRef).
 *   • Error handling — three distinct failure modes (see the numbered comments in
 *     handleFileReady), each surfaced as a recoverable error that keeps the file
 *     so the user can retry.
 */

import { useEffect, useRef, useState } from 'react'
import type { CalendarEvent, Screen } from '@/types'
import NavBar from '@/components/NavBar'
import UploadScreen from '@/components/upload/UploadScreen'
import ProcessingScreen from '@/components/processing/ProcessingScreen'
import ResultsScreen from '@/components/results/ResultsScreen'
import ErrorScreen from '@/components/error/ErrorScreen'

interface AppState {
  screen: Screen
  filename: string
  summary: string
  events: CalendarEvent[]
}

const DEFAULT_STATE: AppState = {
  screen: 'upload',
  filename: '',
  summary: '',
  events: [],
}

// ─── SSE parsing ──────────────────────────────────────────────────────────────
// The server sends Server-Sent Events: frames separated by a blank line, each
// with an `event:` line and a `data:` line. We parse one frame's text into its
// event name and raw (still-JSON) data string; the caller decides how to read it.
function parseFrame(raw: string): { event: string; data: string } | null {
  let event = 'message'
  const dataLines: string[] = []
  for (const line of raw.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim()
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart())
  }
  if (dataLines.length === 0) return null
  return { event, data: dataLines.join('\n') }
}

export default function ScreenRouter() {
  const [app, setApp] = useState<AppState>(DEFAULT_STATE)
  const [transitioning, setTransitioning] = useState(false)
  // Accumulates summary text as it streams in; drives the processing screen.
  const [streamingSummary, setStreamingSummary] = useState('')

  const lastFile = useRef<File | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  // True while this component is mounted. Async stream handlers check it before
  // calling setState so we never update state on an unmounted component.
  const mountedRef = useRef(true)

  // Cleanup on unmount: cancel any in-flight stream and block further setState.
  // ScreenRouter is the long-lived root and rarely unmounts in practice, so this
  // is defensive — but it's the correct pattern: aborting the fetch tears down
  // the ReadableStream reader, and the mountedRef guard stops any late setState.
  useEffect(() => {
    return () => {
      mountedRef.current = false
      abortRef.current?.abort()
    }
  }, [])

  const navigate = (partial: Partial<AppState>) => {
    if (!mountedRef.current) return
    setTransitioning(true)
    setTimeout(() => {
      if (!mountedRef.current) return
      setApp(prev => ({ ...prev, ...partial }))
      setTransitioning(false)
    }, 180)
  }

  const handleFileReady = async (file: File) => {
    // Cancel any previous in-flight request and start a fresh AbortController.
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    lastFile.current = file
    setStreamingSummary('') // clear any summary text left over from a prior run
    navigate({ screen: 'processing', filename: file.name })

    const formData = new FormData()
    formData.append('file', file)

    try {
      const res = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
        signal: controller.signal,
      })

      // ── Error case 1: failed request ──────────────────────────────────────
      // Validation/rate-limit failures come back as a plain-JSON error with a
      // 4xx/5xx status (not an event stream). Treat anything that isn't an SSE
      // response as a failed request and surface a recoverable error.
      const contentType = res.headers.get('content-type') ?? ''
      if (!res.ok || !contentType.includes('text/event-stream') || !res.body) {
        navigate({ screen: 'error', filename: file.name })
        return
      }

      // Read the SSE body incrementally. `receivedDone` lets us distinguish a
      // clean finish from a connection that dropped mid-stream (error case 3).
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let receivedDone = false

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        // `stream: true` lets the decoder hold onto a multi-byte character that
        // was split across two chunks, rather than emitting a broken char.
        buffer += decoder.decode(value, { stream: true })

        // SSE frames are separated by a blank line ("\n\n"). A single read might
        // contain several frames, or half of one — so we split, process every
        // COMPLETE frame, and keep the trailing partial in the buffer for the
        // next read to finish.
        const parts = buffer.split('\n\n')
        buffer = parts.pop() ?? ''

        for (const part of parts) {
          const frame = parseFrame(part)
          if (!frame) continue

          // ── Error case 2: malformed chunk ────────────────────────────────
          // A frame's data should be valid JSON. If it isn't, don't crash
          // silently — abort the read and show a recoverable error.
          let payload: unknown
          try {
            payload = JSON.parse(frame.data)
          } catch {
            await reader.cancel()
            navigate({ screen: 'error', filename: file.name })
            return
          }

          if (frame.event === 'delta') {
            // Human-readable summary text. We render it progressively — but we
            // deliberately do NOT parse or render any structured/actionable data
            // mid-stream; events arrive only in the terminal `done` frame below.
            const { text } = payload as { text: string }
            if (mountedRef.current) setStreamingSummary(prev => prev + text)
          } else if (frame.event === 'done') {
            const { summary, events } = payload as { summary: string; events: CalendarEvent[] }
            // Guard against a malformed terminal frame (case 2, terminal form).
            if (!Array.isArray(events)) {
              await reader.cancel()
              navigate({ screen: 'error', filename: file.name })
              return
            }
            receivedDone = true
            navigate({ screen: 'results', filename: file.name, summary, events })
            return
          } else if (frame.event === 'error') {
            // Server reported a sanitized, in-band error. Recoverable: keep the
            // file so the user can retry from the error screen.
            navigate({ screen: 'error', filename: file.name })
            return
          }
        }
      }

      // ── Error case 3: dropped connection ────────────────────────────────────
      // The stream closed without ever sending a `done` frame — the connection
      // dropped mid-extraction. Surface a recoverable error.
      if (!receivedDone) {
        navigate({ screen: 'error', filename: file.name })
      }
    } catch (err) {
      // Abort is normal (the user started a new request, or we unmounted) —
      // swallow it. Anything else (network drop, etc.) is a recoverable error.
      if (err instanceof Error && err.name === 'AbortError') return
      navigate({ screen: 'error', filename: file.name })
    } finally {
      // Clear the ref only if it still points at *our* controller — a newer
      // request may have replaced it (the abortRef-leak fix from 564c366).
      if (abortRef.current === controller) abortRef.current = null
    }
  }

  const reset = () => navigate({ screen: 'upload', filename: '', summary: '', events: [] })

  return (
    <div className="flex flex-col min-h-screen bg-canvas">
      <NavBar onLogoClick={reset} />

      <main className="flex-1 flex flex-col items-center px-4 pt-8 pb-8">
        <div className="w-full max-w-[480px]">
          <div key={app.screen} className={transitioning ? 'screen-exit' : 'screen-enter'}>
            {app.screen === 'upload' && (
              <UploadScreen onFileReady={handleFileReady} />
            )}
            {app.screen === 'processing' && (
              <ProcessingScreen filename={app.filename} summary={streamingSummary} />
            )}
            {app.screen === 'results' && (
              <ResultsScreen
                filename={app.filename}
                summary={app.summary}
                events={app.events}
                onReset={reset}
              />
            )}
            {app.screen === 'error' && (
              <ErrorScreen
                filename={app.filename}
                onRetry={() => lastFile.current && handleFileReady(lastFile.current)}
                onReset={reset}
              />
            )}
          </div>
        </div>
      </main>

    </div>
  )
}
