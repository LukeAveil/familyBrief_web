/**
 * useLeftPanelStore — state for the conversational (stream) panel ONLY.
 * ────────────────────────────────────────────────────────────────────────────
 * This holds everything the left panel renders and NOTHING the right panel does:
 * the streaming summary, the agent-status stage, and a streaming-side error. The
 * events array lives in a SEPARATE store (`useEventsStore`) on purpose.
 *
 * WHY TWO STORES INSTEAD OF ONE LIFTED STATE (the architectural point):
 *   The old design lifted everything into ScreenRouter's `useState`. Every
 *   summary token called setState on that shared object, so the whole subtree —
 *   including the events display — re-rendered on every token. The events list
 *   doesn't change while the summary types out, so those renders were pure waste.
 *
 *   Splitting into two stores makes the isolation STRUCTURAL rather than a matter
 *   of discipline. The right panel imports `useEventsStore` and never imports
 *   this module, so it *cannot* subscribe to `summary` — there is no selector it
 *   could write that would re-render it on a summary token. A single store with
 *   selectors could achieve the same isolation, but one careless
 *   `useStore(s => s)` re-subscribes to everything; here the boundary can't be
 *   crossed by accident. That guarantee is the whole exercise.
 *
 * WHY STATUS IS A STORED STAGE, NOT DERIVED:
 *   `status` is set from explicit `status` stream chunks the pipeline emits (see
 *   AgentStage in lib/extract-events). The panel renders the stage verbatim; it
 *   never infers "we must be extracting now" from summary/events timing. The
 *   pipeline is the only layer that truly knows when it transitions, so it says
 *   so, and the UI stays a dumb renderer of that signal.
 */

import { create } from 'zustand'
import type { AgentStage } from '@/lib/extract-events'

/**
 * FOLLOW-ON SHAPE (chat) — reserved, unused in the MVP.
 * The next iteration adds a chat input under the status line and a running
 * transcript. That transcript will live here, in the left panel's store,
 * alongside the summary — because it's part of the same conversational surface
 * and must have the same render isolation from the events panel. Declaring the
 * slice now (empty, untouched) means adding chat later is additive: new actions
 * on this store, no restructuring of the panel/store boundary.
 */
export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
}

interface LeftPanelState {
  /** Human-readable summary, accumulated token-by-token as deltas arrive. */
  summary: string
  /** Current agent stage, or null when idle / after it clears on completion. */
  status: AgentStage | null
  /** Streaming-side error. Rendered in the left panel; never touches the right. */
  error: string | null
  /** Reserved for chat (see above). Always [] in the MVP. */
  chatMessages: ChatMessage[]

  /** Append a streamed summary slice (the live typing effect). */
  appendSummary: (text: string) => void
  /** Replace the summary with the final, trimmed version on completion. */
  setSummary: (full: string) => void
  /** Set the agent stage (or null to clear the status line). */
  setStatus: (stage: AgentStage | null) => void
  /** Record a streaming-side error. */
  setError: (message: string) => void
  /** Reset to the initial state at the start of a new upload / on reset. */
  reset: () => void
}

const INITIAL = {
  summary: '',
  status: null as AgentStage | null,
  error: null as string | null,
  chatMessages: [] as ChatMessage[],
}

export const useLeftPanelStore = create<LeftPanelState>((set) => ({
  ...INITIAL,
  appendSummary: (text) => set((s) => ({ summary: s.summary + text })),
  setSummary: (full) => set({ summary: full }),
  setStatus: (stage) => set({ status: stage }),
  setError: (message) => set({ error: message }),
  reset: () => set({ ...INITIAL }),
}))
