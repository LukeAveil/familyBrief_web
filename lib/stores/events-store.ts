/**
 * useEventsStore — state for the structured (events) panel ONLY.
 * ────────────────────────────────────────────────────────────────────────────
 * Deliberately the mirror image of useLeftPanelStore: it holds the extracted
 * events and the right panel's own lifecycle (`phase`) and error, and nothing
 * about the summary or the agent status. See left-panel-store.ts for the full
 * reasoning on why the two are separate modules — the short version is that the
 * right panel importing ONLY this store is what makes its render isolation
 * structural instead of a convention someone has to remember.
 *
 * WHY `phase` LIVES HERE (and not read from the left store):
 *   The right panel needs to distinguish "still extracting, no events yet" from
 *   "done, genuinely zero events" — otherwise it would flash "No events found"
 *   for the whole stream. It could learn that from the left panel's agent status,
 *   but reading the left store would re-couple the panels and re-introduce the
 *   exact re-render the split exists to prevent. So the right panel gets its own
 *   `phase`, driven by the same consumer, and never looks left.
 */

import { create } from 'zustand'
import type { CalendarEvent } from '@/types'

/**
 * Right-panel lifecycle:
 *  - `idle`    — nothing uploaded yet.
 *  - `loading` — an upload is in flight; show a skeleton, not an empty state.
 *  - `ready`   — events have arrived (possibly an empty array = truly none).
 *  - `error`   — extraction failed on the events side; show the error, not events.
 */
export type EventsPhase = 'idle' | 'loading' | 'ready' | 'error'

interface EventsState {
  events: CalendarEvent[]
  phase: EventsPhase
  /** The uploaded file's name — context shown in the events display header. Lives
   *  here (not read from the left store) so the right panel stays single-store. */
  filename: string
  /** Events-side error. Rendered in the right panel; never touches the left. */
  error: string | null

  /** Mark an upload as started — right panel shows its loading skeleton. */
  startLoading: (filename: string) => void
  /** Populate the events atomically (they arrive whole, never partial). */
  setEvents: (events: CalendarEvent[]) => void
  /** Record an events-side error (e.g. a malformed terminal frame). */
  setError: (message: string) => void
  /** Reset to the initial state at the start of a new upload / on reset. */
  reset: () => void
}

const INITIAL = {
  events: [] as CalendarEvent[],
  phase: 'idle' as EventsPhase,
  filename: '',
  error: null as string | null,
}

export const useEventsStore = create<EventsState>((set) => ({
  ...INITIAL,
  startLoading: (filename) => set({ phase: 'loading', events: [], error: null, filename }),
  setEvents: (events) => set({ events, phase: 'ready', error: null }),
  setError: (message) => set({ error: message, phase: 'error' }),
  reset: () => set({ ...INITIAL }),
}))
