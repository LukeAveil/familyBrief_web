import { StrictMode } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ChatPanel from '@/components/workspace/ChatPanel'
import { useLeftPanelStore } from '@/lib/stores/left-panel-store'
import { useEventsStore } from '@/lib/stores/events-store'

// TextEncoder/TextDecoder are polyfilled globally in jest.setup.ts.

// ─── fetch + SSE mocking (same shape as ScreenRouter.test) ───────────────────
const fetchMock = jest.fn()
beforeEach(() => {
  fetchMock.mockReset()
  Object.assign(global, { fetch: fetchMock })
  useLeftPanelStore.getState().reset()
  useEventsStore.getState().reset()
})

const enc = (s: string) => new TextEncoder().encode(s)
const deltaFrame = (text: string) => `event: delta\ndata: ${JSON.stringify({ text })}\n\n`
const doneFrame = () => `event: done\ndata: {}\n\n`

function sseResponse(frames: string[]) {
  let i = 0
  const reader = {
    read: () =>
      i < frames.length
        ? Promise.resolve({ done: false, value: enc(frames[i++]) })
        : Promise.resolve({ done: true, value: undefined }),
    cancel: () => Promise.resolve(),
  }
  return {
    ok: true,
    headers: { get: () => 'text/event-stream; charset=utf-8' },
    body: { getReader: () => reader },
  }
}

// A finished extraction is the precondition for chat: summary present, status
// complete (that's when ChatPanel shows its input).
function seedReadyWorkspace() {
  useLeftPanelStore.getState().setSummary('Sports day is on Thursday.')
  useLeftPanelStore.getState().setStatus('complete')
}

// Rendered under <StrictMode> ON PURPOSE. StrictMode's mount does
// setup → cleanup → setup; a naive `mountedRef = useRef(true)` that's only reset
// in cleanup ends up stuck `false`, and the stream reader's mounted-guard then
// bails on the first frame — a reply that never renders (a bubble stuck on "…").
// This test reproduces exactly that path, so it fails if the guard regresses.
it('streams a reply into the transcript under StrictMode', async () => {
  seedReadyWorkspace()
  fetchMock.mockResolvedValue(
    sseResponse([deltaFrame('It starts at '), deltaFrame('9:30 AM.'), doneFrame()]),
  )

  render(
    <StrictMode>
      <ChatPanel />
    </StrictMode>,
  )

  await userEvent.type(
    screen.getByLabelText('Ask a question about this letter'),
    'What time is sports day?',
  )
  await userEvent.click(screen.getByRole('button', { name: 'Send' }))

  // The user's question is in the transcript…
  expect(await screen.findByText('What time is sports day?')).toBeInTheDocument()
  // …and the streamed reply grew into a single assistant bubble.
  expect(await screen.findByText('It starts at 9:30 AM.')).toBeInTheDocument()

  // The route received the full context: summary as `letter`, plus the turn.
  const [, init] = fetchMock.mock.calls[0]
  const sent = JSON.parse(init.body)
  expect(sent.letter).toBe('Sports day is on Thursday.')
  expect(sent.messages).toEqual([{ role: 'user', content: 'What time is sports day?' }])

  // Input re-enabled once the stream completed.
  expect(screen.getByLabelText('Ask a question about this letter')).not.toBeDisabled()
})

it('sends the full turn history on a follow-up question', async () => {
  seedReadyWorkspace()
  fetchMock.mockResolvedValue(sseResponse([deltaFrame('First answer.'), doneFrame()]))
  render(
    <StrictMode>
      <ChatPanel />
    </StrictMode>,
  )

  const input = () => screen.getByLabelText('Ask a question about this letter')
  await userEvent.type(input(), 'Q1')
  await userEvent.click(screen.getByRole('button', { name: 'Send' }))
  await screen.findByText('First answer.')

  fetchMock.mockResolvedValue(sseResponse([deltaFrame('Second answer.'), doneFrame()]))
  await userEvent.type(input(), 'Q2')
  await userEvent.click(screen.getByRole('button', { name: 'Send' }))
  await screen.findByText('Second answer.')

  // The second request carries every prior turn plus the new question — the
  // stateless API is handed the whole conversation each time.
  const [, secondInit] = fetchMock.mock.calls[1]
  expect(JSON.parse(secondInit.body).messages).toEqual([
    { role: 'user', content: 'Q1' },
    { role: 'assistant', content: 'First answer.' },
    { role: 'user', content: 'Q2' },
  ])
})
