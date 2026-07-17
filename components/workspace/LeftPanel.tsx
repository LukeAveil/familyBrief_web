'use client'

/**
 * LeftPanel — the conversational (stream) side of the workspace.
 * ────────────────────────────────────────────────────────────────────────────
 * SUBSCRIPTION BOUNDARY: this component reads from `useLeftPanelStore` and from
 * NOTHING else. It has no idea the events store exists. That one-way boundary is
 * the point of the two-store split — because the summary and status live in a
 * store the right panel never imports, a summary token can only ever re-render
 * THIS panel. (And conversely: nothing here can re-render the events panel.)
 *
 * Each `useLeftPanelStore(selector)` call subscribes to just that slice, so this
 * panel re-renders only when the summary, status, or error actually change.
 *
 * It renders three things, top to bottom:
 *   1. the streaming summary (live typing effect),
 *   2. the agent status as a SINGLE changing line of text (not a stepper), and
 *   3. a reserved slot for the future chat input — see the comment below.
 */

import { useCallback } from 'react'
import type { AgentStage } from '@/lib/extract-events'
import { useLeftPanelStore } from '@/lib/stores/left-panel-store'
import { AlertIcon, RefreshIcon } from '@/components/icons'
import ChatPanel from '@/components/workspace/ChatPanel'

interface LeftPanelProps {
  /** Re-run the last upload after a streaming-side error (orchestration). */
  onRetry: () => void
}

// Map the agent stage to the single line shown under the summary. `complete`
// clears the line (null) — the work is done, so the status narration goes quiet.
// This is presentation only; the stage itself is the data (from the pipeline).
const STATUS_LABELS: Record<AgentStage, string | null> = {
  reading: 'Reading letter…',
  summarizing: 'Writing summary…',
  extracting: 'Extracting events…',
  complete: null,
}

export default function LeftPanel({ onRetry }: LeftPanelProps) {
  // Narrow selectors — one slice each. See the subscription-boundary note above.
  const summary = useLeftPanelStore((s) => s.summary)
  const status = useLeftPanelStore((s) => s.status)
  const error = useLeftPanelStore((s) => s.error)

  const retry = useCallback(() => onRetry(), [onRetry])

  // We're actively streaming while there's a live stage that hasn't completed and
  // nothing has errored — that's when the blinking caret belongs on the summary.
  const streaming = status !== null && status !== 'complete' && !error
  const statusLine = status ? STATUS_LABELS[status] : null

  return (
    <section
      className="bg-surface border border-line rounded-[28px] px-7 py-7 shadow-md w-full"
      aria-label="Summary and status"
    >
      {error ? (
        // Streaming-side error, rendered IN PLACE. It sets only this panel's error
        // (via the left store), so the events panel is untouched — one side failing
        // never blanks the other.
        <div className="text-center py-2">
          <div className="w-14 h-14 rounded-full bg-error-light border-[1.5px] border-error-line text-error flex items-center justify-center mx-auto mb-4">
            <span className="w-7 h-7 flex">
              <AlertIcon />
            </span>
          </div>
          <h2 className="text-[18px] font-bold tracking-[-0.3px] text-ink mb-2">
            Couldn&apos;t read that one
          </h2>
          <p className="text-[14px] text-ink-muted leading-[1.55] mb-5">{error}</p>
          <button
            className="btn-primary-base inline-flex items-center justify-center gap-[7px] bg-primary text-white w-full px-5 py-[11px] rounded-lg text-[15px] font-semibold"
            onClick={retry}
          >
            <span className="w-[18px] h-[18px] flex items-center">
              <RefreshIcon />
            </span>
            Try again
          </button>
        </div>
      ) : (
        <>
          {/* Live summary — types out token by token as the store accumulates it. */}
          <p className="text-[15px] leading-relaxed text-ink whitespace-pre-wrap min-h-[3.5em]">
            {summary.length > 0 ? (
              <>
                {summary}
                {streaming && (
                  <span className="proc-caret" aria-hidden>
                    ▋
                  </span>
                )}
              </>
            ) : (
              <span className="text-ink-subtle">Scanning your document…</span>
            )}
          </p>

          {/* Agent status — a single line that changes, cleared on completion. */}
          {statusLine && (
            <p
              className="text-[13px] text-ink-subtle mt-4 flex items-center gap-2"
              role="status"
              aria-live="polite"
            >
              <span className="proc-caret" aria-hidden>
                ●
              </span>
              {statusLine}
            </p>
          )}

          {/* Chat drops into the slot that was reserved here, under the status
              line. It owns its own subscriptions (transcript + input state); this
              panel still reads only `useLeftPanelStore`. Rendered inside the
              non-error branch so a streaming-side failure hides chat too — there's
              nothing to ask about if the letter couldn't be read. */}
          <ChatPanel />
        </>
      )}
    </section>
  )
}
