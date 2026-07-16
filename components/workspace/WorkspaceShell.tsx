'use client'

/**
 * WorkspaceShell — the two-panel layout, and NOTHING else.
 * ────────────────────────────────────────────────────────────────────────────
 * This component holds no state. It doesn't touch either store; it doesn't read
 * summary, status, or events. Its entire job is to place the two panels and hand
 * each the orchestration callbacks it needs. All reactive state lives in the two
 * stores the panels subscribe to individually — the shell is just a frame.
 *
 * LAYOUT: responsive. On a phone (the default, mobile-first) the panels STACK in
 * a column — stream (conversational) on top, events (structured) underneath. At
 * the `lg` breakpoint they sit SIDE BY SIDE, LeftPanel then RightPanel, each
 * taking an equal half. That's the whole layout concern; it's a Tailwind class
 * change here and NOTHING else, because the panels don't know or care how they're
 * arranged — no edit to either panel or its store. `lg:items-start` keeps them
 * top-aligned so a tall events list doesn't stretch the stream panel.
 *
 * `min-w-0` on each column is the flexbox gotcha guard: without it a flex child's
 * min-width defaults to its content, so long unbroken text (a filename, a URL)
 * would blow the column past 50% and break the layout.
 */

import LeftPanel from './LeftPanel'
import RightPanel from './RightPanel'

interface WorkspaceShellProps {
  /** Back to the upload screen (passed to the events panel's reset control). */
  onReset: () => void
  /** Re-run the last upload after a streaming-side error (passed to the stream panel). */
  onRetry: () => void
}

export default function WorkspaceShell({ onReset, onRetry }: WorkspaceShellProps) {
  return (
    <div className="flex flex-col gap-4 w-full lg:flex-row lg:items-start">
      <div className="w-full lg:flex-1 lg:min-w-0">
        <LeftPanel onRetry={onRetry} />
      </div>
      <div className="w-full lg:flex-1 lg:min-w-0">
        <RightPanel onReset={onReset} />
      </div>
    </div>
  )
}
