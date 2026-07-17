'use client'

/**
 * ScreenRouter — the client orchestrator and the consumer end of the stream.
 * ────────────────────────────────────────────────────────────────────────────
 * It owns the upload→workspace journey: which screen is showing, the fetch to
 * /api/upload, reading the Server-Sent Events off the response body, and the
 * error/cancellation/cleanup handling around that stream.
 *
 * WHAT CHANGED FOR THE TWO-PANEL WORKSPACE:
 *   Previously this component ALSO held the summary and events in its own
 *   `useState` and drove a sequence of screens (processing → results). Now the
 *   summary/status/events live in two isolated Zustand stores, and there is a
 *   single persistent `workspace` screen containing both panels. This component
 *   became a pure *router of stream frames into stores* — it holds no summary and
 *   no events itself, so a summary token no longer re-renders it (or anything
 *   under it except the one panel that subscribes to that slice). That is the
 *   whole point of the refactor; see lib/stores/*.
 *
 * Reading a stream in the browser (unchanged):
 *   fetch() resolves as soon as the HEADERS arrive — the body is still flowing.
 *   res.body.getReader() lets us pull it chunk by chunk. Each chunk is raw bytes,
 *   so we decode, buffer, and split off complete SSE frames (separated by a blank
 *   line), then route each frame to the right store action.
 *
 * ERRORS ARE PANEL-SCOPED (not a global error screen):
 *   An events-only failure (a malformed terminal frame) sets ONLY the events
 *   store's error — the streamed summary survives on the left. A whole-stream
 *   failure (rejected request, dropped connection, in-band error) sets BOTH
 *   stores' errors as independent writes, so each panel renders its own error and
 *   neither blanks the other.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { CalendarEvent } from '@/types'
import type { AgentStage } from '@/lib/extract-events'
import NavBar from '@/components/NavBar'
import UploadScreen from '@/components/upload/UploadScreen'
import WorkspaceShell from '@/components/workspace/WorkspaceShell'
import { useLeftPanelStore } from '@/lib/stores/left-panel-store'
import { useEventsStore } from '@/lib/stores/events-store'
import { MOCK_MULTIPLE } from '@/lib/mock-data'

// Only two screens now: the upload entry point and the persistent workspace.
// (The old processing/results/error screens folded into the workspace + its
// panel-scoped error states.)
type WorkspaceScreen = 'upload' | 'workspace'

// Friendly, non-technical error copy — the SDK/network detail never reaches here.
const STREAM_ERROR = 'We couldn’t read that letter. Please try again.'
const EVENTS_ERROR = 'We couldn’t pull the events from that letter.'

// ─── SSE parsing ──────────────────────────────────────────────────────────────
// The server sends Server-Sent Events: frames separated by a blank line, each
// with an `event:` line and a `data:` line. We parse one frame's text into its
// event name and raw (still-JSON) data string; the caller decides how to read it.
// Exported so it can be unit-tested directly — this is fiddly string parsing the
// type checker can't guard.
export function parseFrame(raw: string): { event: string; data: string } | null {
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
  const [screen, setScreen] = useState<WorkspaceScreen>('upload')
  const [transitioning, setTransitioning] = useState(false)

  const lastFile = useRef<File | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  // True while this component is mounted. Async stream handlers check it before
  // touching state so we never update after unmount.
  const mountedRef = useRef(true)

  // NOTE: this component drives the stores through `useXStore.getState()`, NOT by
  // calling the hooks — it deliberately does NOT subscribe to any slice. If it
  // subscribed, every summary token would re-render ScreenRouter (and its whole
  // subtree), defeating the isolation the two stores exist to provide. The router
  // writes; only the panels read.

  // Cleanup on unmount: cancel any in-flight stream and block further setState.
  useEffect(() => {
    return () => {
      mountedRef.current = false
      abortRef.current?.abort()
    }
  }, [])

  // Dev-only preview: `/?preview=results` seeds the stores with mock events
  // spanning every confidence level and jumps to the workspace, so the confidence
  // styling can be eyeballed without a real upload. No-op in production. Runs in
  // an effect (not initial state) to avoid a hydration mismatch.
  useEffect(() => {
    if (process.env.NODE_ENV === 'production') return
    const preview = new URLSearchParams(window.location.search).get('preview')
    /* eslint-disable react-hooks/set-state-in-effect */
    if (preview === 'results') {
      useLeftPanelStore.getState().reset()
      useLeftPanelStore
        .getState()
        .setSummary(
          'This preview shows a mix of confidence levels so you can see how flagged items look. High-confidence items appear as normal; medium and low ones are marked for a second look.',
        )
      useLeftPanelStore.getState().setStatus('complete')
      useEventsStore.getState().startLoading('sample-newsletter.pdf')
      useEventsStore.getState().setEvents(MOCK_MULTIPLE)
      setScreen('workspace')
    } else if (preview === 'empty') {
      useLeftPanelStore.getState().reset()
      useLeftPanelStore.getState().setStatus('complete')
      useEventsStore.getState().startLoading('sample-newsletter.pdf')
      useEventsStore.getState().setEvents([])
      setScreen('workspace')
    }
    /* eslint-enable react-hooks/set-state-in-effect */
    // Stores are module-level singletons (not component scope), so they aren't deps.
  }, [])

  // Small screen transition (kept from the original for polish).
  const navigate = useCallback((next: WorkspaceScreen) => {
    if (!mountedRef.current) return
    setTransitioning(true)
    setTimeout(() => {
      if (!mountedRef.current) return
      setScreen(next)
      setTransitioning(false)
    }, 180)
  }, [])

  // Both panels failed independently (whole-stream failure). Independent writes:
  // each panel reads only its own store, so neither error depends on the other.
  const failBoth = useCallback(() => {
    if (!mountedRef.current) return
    useLeftPanelStore.getState().setError(STREAM_ERROR)
    useEventsStore.getState().setError(EVENTS_ERROR)
  }, [])

  const handleFileReady = useCallback(
    async (file: File) => {
      // Cancel any previous in-flight request and start a fresh AbortController.
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller

      lastFile.current = file
      // Fresh session: clear both stores and put the events panel into its loading
      // state. Status is left null — it is driven exclusively by `status` frames
      // (the pipeline emits `reading` the instant the stream opens).
      // This reset() also empties `chatMessages` (it's part of the left store's
      // INITIAL), so a new letter starts a fresh conversation — no separate
      // clearChat() call is needed here. Chat clears on upload rather than
      // persisting because it's grounded in one specific letter's summary+events;
      // carrying it to a different letter would answer questions against the wrong
      // context. (clearChat() exists as an explicit action for callers that want
      // to reset only the chat without touching the summary/events.)
      useLeftPanelStore.getState().reset()
      useEventsStore.getState().reset()
      useEventsStore.getState().startLoading(file.name)
      navigate('workspace')

      const formData = new FormData()
      formData.append('file', file)

      try {
        const res = await fetch('/api/upload', {
          method: 'POST',
          body: formData,
          signal: controller.signal,
        })

        // ── Failure 1: non-SSE response (validation/rate-limit reject) ──────────
        const contentType = res.headers.get('content-type') ?? ''
        if (!res.ok || !contentType.includes('text/event-stream') || !res.body) {
          failBoth()
          return
        }

        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        let receivedDone = false

        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          buffer += decoder.decode(value, { stream: true })

          // SSE frames are separated by a blank line. Process every COMPLETE
          // frame and keep the trailing partial for the next read.
          const parts = buffer.split('\n\n')
          buffer = parts.pop() ?? ''

          for (const part of parts) {
            const frame = parseFrame(part)
            if (!frame) continue

            // ── Failure 2: malformed data frame ───────────────────────────────
            let payload: unknown
            try {
              payload = JSON.parse(frame.data)
            } catch {
              await reader.cancel()
              failBoth()
              return
            }

            if (!mountedRef.current) return

            if (frame.event === 'status') {
              // Explicit agent-stage signal → left panel only.
              const { stage } = payload as { stage: AgentStage }
              useLeftPanelStore.getState().setStatus(stage)
            } else if (frame.event === 'delta') {
              // Summary token → append to the left store (the live typing effect).
              const { text } = payload as { text: string }
              useLeftPanelStore.getState().appendSummary(text)
            } else if (frame.event === 'done') {
              const { summary, events: evts } = payload as {
                summary: string
                events: CalendarEvent[]
              }
              // The final summary is safe regardless — set it on the left.
              useLeftPanelStore.getState().setSummary(summary)
              // ── Failure 2 (terminal form): events not an array → events side
              // only. The summary above still stands, so the left panel is intact.
              if (!Array.isArray(evts)) {
                useEventsStore.getState().setError(EVENTS_ERROR)
              } else {
                useEventsStore.getState().setEvents(evts)
              }
              receivedDone = true
              // Don't return — a trailing `status: complete` frame may follow.
            } else if (frame.event === 'error') {
              // Server reported a sanitized, in-band failure of the whole stream.
              failBoth()
              return
            }
          }
        }

        // ── Failure 3: stream closed without a `done` frame (dropped) ──────────
        if (!receivedDone) failBoth()
      } catch (err) {
        // Abort is normal (new request / unmount) — swallow it.
        if (err instanceof Error && err.name === 'AbortError') return
        failBoth()
      } finally {
        // Clear the ref only if it still points at *our* controller.
        if (abortRef.current === controller) abortRef.current = null
      }
    },
    [navigate, failBoth],
  )

  const reset = useCallback(() => {
    useLeftPanelStore.getState().reset()
    useEventsStore.getState().reset()
    navigate('upload')
  }, [navigate])

  const retry = useCallback(() => {
    if (lastFile.current) handleFileReady(lastFile.current)
  }, [handleFileReady])

  return (
    <div className="flex flex-col min-h-screen bg-canvas">
      <NavBar onLogoClick={reset} />

      <main className="flex-1 flex flex-col items-center px-4 pt-8 pb-8">
        {/* Upload stays a narrow centered card; the workspace widens on desktop so
            its two panels have room to sit side by side (it's still a single
            capped column on mobile, where the panels stack). */}
        <div className={`w-full ${screen === 'workspace' ? 'max-w-[980px]' : 'max-w-[480px]'}`}>
          <div key={screen} className={transitioning ? 'screen-exit' : 'screen-enter'}>
            {screen === 'upload' && <UploadScreen onFileReady={handleFileReady} />}
            {screen === 'workspace' && <WorkspaceShell onReset={reset} onRetry={retry} />}
          </div>
        </div>
      </main>
    </div>
  )
}
