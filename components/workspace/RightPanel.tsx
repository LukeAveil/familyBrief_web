'use client'

/**
 * RightPanel — the structured (events) side of the workspace.
 * ────────────────────────────────────────────────────────────────────────────
 * SUBSCRIPTION BOUNDARY: this component reads from `useEventsStore` and NOTHING
 * else. It never imports the left panel's store, so there is no code path by
 * which a streaming summary token or an agent-status change could re-render it.
 * That is the architectural claim the whole two-store split exists to make, and
 * the render counter below is here to prove it (see VERIFY THE ISOLATION).
 *
 * When `phase === 'ready'` it renders the EXISTING events display (ResultsScreen)
 * unchanged — confidence indicators and all — passing no `summary` so the summary
 * stays on the left where it belongs. The confidence UI is deliberately reused,
 * not reimplemented.
 */

import { useEffect, useRef } from 'react'
import { useEventsStore } from '@/lib/stores/events-store'
import ResultsScreen from '@/components/results/ResultsScreen'
import { AlertIcon } from '@/components/icons'

interface RightPanelProps {
  /** "Upload another letter" — navigates back to the upload screen (orchestration). */
  onReset: () => void
}

export default function RightPanel({ onReset }: RightPanelProps) {
  // Narrow selectors — one slice each. Left-store changes can't reach these.
  const events = useEventsStore((s) => s.events)
  const phase = useEventsStore((s) => s.phase)
  const error = useEventsStore((s) => s.error)
  const filename = useEventsStore((s) => s.filename)

  // ── VERIFY THE ISOLATION ──────────────────────────────────────────────────
  // Commit counter for the manual isolation check. We count in an effect (with no
  // dep array it runs after EVERY commit) because touching a ref during render is
  // both a React anti-pattern and a lint error — effects are the sanctioned place.
  //
  // Under `npm run dev` the counter jumps on mount (React StrictMode intentionally
  // double-invokes, so you'll see the first couple of ticks arrive in a pair) and
  // once more when events arrive — and then NEVER again while the summary streams
  // or the status changes. The number itself is secondary; the signal is that it
  // stays FLAT during streaming. If it climbs with every summary token, the panels
  // are sharing state and the architecture has regressed. Silent in tests/prod.
  const commitCount = useRef(0)
  useEffect(() => {
    commitCount.current += 1
    if (process.env.NODE_ENV === 'development') {
      console.log(`[RightPanel] commit #${commitCount.current} (phase=${phase})`)
    }
  })

  if (phase === 'error') {
    // Events-side error, rendered IN PLACE. Set only via the events store, so the
    // left panel keeps whatever summary it already streamed — independent panels.
    return (
      <section
        className="bg-surface border border-line rounded-[28px] px-7 py-7 shadow-md w-full text-center"
        aria-label="Events"
      >
        <div className="w-14 h-14 rounded-full bg-error-light border-[1.5px] border-error-line text-error flex items-center justify-center mx-auto mb-4">
          <span className="w-7 h-7 flex">
            <AlertIcon />
          </span>
        </div>
        <h2 className="text-[18px] font-bold tracking-[-0.3px] text-ink mb-2">
          Couldn&apos;t list the events
        </h2>
        <p className="text-[14px] text-ink-muted leading-[1.55]">{error}</p>
      </section>
    )
  }

  if (phase === 'idle' || phase === 'loading') {
    // Skeleton while extraction is in flight — NOT the "No events found" empty
    // state, which is reserved for a genuinely-empty `ready` result.
    return (
      <section
        className="bg-surface border border-line rounded-[28px] px-7 py-7 shadow-md w-full"
        aria-label="Events"
        aria-busy={phase === 'loading'}
      >
        <p className="text-[13px] font-bold text-ink-subtle uppercase tracking-[0.8px] mb-4">
          Events
        </p>
        <div className="flex flex-col gap-3" aria-hidden>
          {[0, 1, 2].map((i) => (
            <div key={i} className="border border-line rounded-xl px-4 py-4">
              <div className="h-3 w-1/2 bg-line rounded-sm mb-2" />
              <div className="h-2.5 w-1/3 bg-line rounded-sm" />
            </div>
          ))}
        </div>
      </section>
    )
  }

  // phase === 'ready' — hand the extracted events to the existing display. No
  // `summary` prop: the summary lives on the left. `compact` keeps the cards
  // tighter for the stacked column layout.
  return (
    <section
      className="bg-surface border border-line rounded-[28px] px-6 py-6 shadow-md w-full"
      aria-label="Events"
    >
      <ResultsScreen filename={filename} events={events} onReset={onReset} compact />
    </section>
  )
}
