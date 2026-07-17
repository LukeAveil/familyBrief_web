/**
 * Render-isolation test — the architectural claim, pinned.
 * ════════════════════════════════════════════════════════════════════════════
 * The whole point of the two-store split is that the events (right) panel must
 * NOT re-render while the summary streams token-by-token or the agent status
 * changes. This test proves it mechanically instead of by eyeballing the dev
 * console: it mounts both panels, pumps many summary deltas and status changes
 * through the LEFT store, and asserts — via a React Profiler wrapped around the
 * RIGHT panel — that the right panel commits zero additional times. Only an
 * events-store change is allowed to commit it.
 *
 * If someone later re-couples the panels (e.g. lifts state, or has RightPanel
 * read the left store), this test fails loudly with a commit count that tracks
 * the token count — exactly the regression the architecture exists to prevent.
 */

import { Profiler } from 'react'
import { act, render, screen } from '@testing-library/react'
import LeftPanel from '@/components/workspace/LeftPanel'
import RightPanel from '@/components/workspace/RightPanel'
import { useLeftPanelStore } from '@/lib/stores/left-panel-store'
import { useEventsStore } from '@/lib/stores/events-store'
import type { CalendarEvent } from '@/types'

const EVENT: CalendarEvent = {
  id: 1,
  title: 'Sports Day',
  date: 'Thursday, 26 June 2025',
  time: '9:30 AM',
  location: 'Playing Fields',
  notes: null,
  cal: '20250626T093000/20250626T103000',
  confidence: { title: 'high', datetime: 'high', location: 'high' },
}

beforeEach(() => {
  useLeftPanelStore.getState().reset()
  useEventsStore.getState().reset()
})

it('the events panel does not re-render while the summary streams or status changes', () => {
  // Start a session: events panel in its loading state, ready to receive events.
  act(() => {
    useEventsStore.getState().startLoading('letter.pdf')
  })

  let rightCommits = 0
  render(
    <>
      <LeftPanel onRetry={() => {}} />
      <Profiler id="right" onRender={() => (rightCommits += 1)}>
        <RightPanel onReset={() => {}} />
      </Profiler>
    </>,
  )

  // Baseline: the mount commit. (No StrictMode in the test renderer, so this is a
  // single clean commit — unlike `npm run dev`, which double-invokes on mount.)
  const baseline = rightCommits
  expect(baseline).toBeGreaterThan(0)

  // Stream 30 summary tokens and cycle the agent status through every stage —
  // exactly the traffic that hammered the old lifted state on every token.
  act(() => {
    useLeftPanelStore.getState().setStatus('reading')
    useLeftPanelStore.getState().setStatus('summarizing')
    for (let i = 0; i < 30; i++) {
      useLeftPanelStore.getState().appendSummary(`tok${i} `)
    }
    useLeftPanelStore.getState().setStatus('extracting')
  })

  // The left panel genuinely updated (proving the stream traffic was real)…
  expect(screen.getByText(/tok29/)).toBeInTheDocument()
  // …while the right panel committed ZERO additional times. This is the claim.
  expect(rightCommits).toBe(baseline)

  // Only an events-store change is allowed to commit the right panel.
  act(() => {
    useEventsStore.getState().setEvents([EVENT])
  })
  expect(rightCommits).toBe(baseline + 1)
  expect(screen.getByText('Found 1 event')).toBeInTheDocument()
})

it('the events panel does not re-render while chat streams (phase three)', () => {
  // A finished extraction: events present, status complete (so the chat input is
  // live — ChatPanel only shows its input once `status === 'complete'`).
  act(() => {
    useEventsStore.getState().startLoading('letter.pdf')
    useEventsStore.getState().setEvents([EVENT])
    useLeftPanelStore.getState().setSummary('Sports day is on Thursday.')
    useLeftPanelStore.getState().setStatus('complete')
  })

  let rightCommits = 0
  render(
    <>
      <LeftPanel onRetry={() => {}} />
      <Profiler id="right" onRender={() => (rightCommits += 1)}>
        <RightPanel onReset={() => {}} />
      </Profiler>
    </>,
  )
  const baseline = rightCommits
  expect(baseline).toBeGreaterThan(0)

  // A full chat exchange: user turn, an empty assistant turn, then 20 streamed
  // reply chunks growing that one message — exactly the traffic a live reply
  // produces. All of it lands in the LEFT store.
  act(() => {
    useLeftPanelStore.getState().appendUserMessage('What time is sports day?')
    useLeftPanelStore.getState().startAssistantMessage()
    for (let i = 0; i < 20; i++) {
      useLeftPanelStore.getState().appendAssistantChunk(`word${i} `)
    }
  })

  // The left panel genuinely rendered the streamed reply…
  expect(screen.getByText(/word19/)).toBeInTheDocument()
  // …while the right panel committed ZERO additional times across the whole
  // exchange. This is the phase-three claim: chat is on the isolated side.
  expect(rightCommits).toBe(baseline)

  // And clearing the chat (as a new upload would) still doesn't touch the right.
  act(() => {
    useLeftPanelStore.getState().clearChat()
  })
  expect(rightCommits).toBe(baseline)
})
