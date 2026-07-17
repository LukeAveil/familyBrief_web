'use client'

/**
 * ChatPanel — the follow-up conversation, mounted under the agent status in the
 * left panel. It's the second thing on the conversational side of the workspace,
 * after the streamed summary.
 * ────────────────────────────────────────────────────────────────────────────
 * SUBSCRIPTION DISCIPLINE (the whole architectural point, extended to chat):
 *   This component subscribes to `useLeftPanelStore` ONLY — the transcript and the
 *   agent status. It does NOT subscribe to the events store. It still needs the
 *   events (to send them as context), but it reads them at SUBMIT time via
 *   `useEventsStore.getState()` — a one-shot read, not a subscription. So chat
 *   activity can never re-render the events panel, and the events panel changing
 *   can never re-render this. The isolation holds by construction, same as the
 *   summary/events split.
 *
 * The reply streams in exactly like the summary does: one assistant message grows
 * token by token (see `appendAssistantChunk` in the store), not a bubble per token.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useLeftPanelStore } from '@/lib/stores/left-panel-store'
import { useEventsStore } from '@/lib/stores/events-store'
import { parseFrame } from '@/components/ScreenRouter'

export default function ChatPanel() {
  // Narrow selectors — one slice each. Same discipline as LeftPanel.
  const chatMessages = useLeftPanelStore((s) => s.chatMessages)
  const status = useLeftPanelStore((s) => s.status)

  // Controlled input + a local "streaming" flag. Both are component-local state,
  // NOT store state — typing and the in-flight flag are this component's concern
  // and nothing else needs to re-render for them.
  const [input, setInput] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)

  // Abort any in-flight chat request if the component unmounts mid-stream.
  const abortRef = useRef<AbortController | null>(null)
  const mountedRef = useRef(true)
  useEffect(() => {
    // Set true in the effect BODY, not just the useRef initializer. Under React
    // StrictMode (on in dev) mount runs setup → cleanup → setup; the cleanup flips
    // this to false, and without re-setting it here the second setup would leave it
    // stuck false for the component's whole life — so the stream reader's
    // `if (!mountedRef.current) return` guard would bail on the first frame and the
    // reply would never render. Re-setting on every setup keeps it correct across
    // StrictMode's double-invoke and Fast Refresh remounts.
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      abortRef.current?.abort()
    }
  }, [])

  // Chat is only meaningful once extraction has finished (`complete`) — before
  // that there's no summary or events to answer from. The status line above goes
  // quiet at `complete`, and that's exactly when the input should appear.
  const ready = status === 'complete'

  const send = useCallback(async () => {
    const text = input.trim()
    // Guard: nothing to send, or a reply is already streaming. The disabled input
    // enforces this in the UI too — this is the belt to that suspenders.
    if (!text || isStreaming) return

    const left = useLeftPanelStore.getState()

    // Build the outgoing turn list from the transcript BEFORE we mutate it, then
    // append the placeholder assistant turn for the reply to stream into. Map the
    // store's `text` field to the API's `content` field.
    const outgoing = [
      ...left.chatMessages.map((m) => ({ role: m.role, content: m.text })),
      { role: 'user' as const, content: text },
    ]
    left.appendUserMessage(text)
    left.startAssistantMessage()
    setInput('')
    setIsStreaming(true)

    // Stable context, read one-shot (no subscription): the summary stands in for
    // the letter (it's the only letter-derived text the client holds), and the
    // events come straight from the events store.
    const letter = left.summary
    const events = useEventsStore.getState().events

    const controller = new AbortController()
    abortRef.current = controller

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ letter, events, messages: outgoing }),
        signal: controller.signal,
      })

      const contentType = res.headers.get('content-type') ?? ''
      if (!res.ok || !contentType.includes('text/event-stream') || !res.body) {
        useLeftPanelStore.getState().appendAssistantChunk('Sorry — something went wrong.')
        return
      }

      // Same SSE read loop as ScreenRouter: pull bytes, decode, split complete
      // frames on the blank line, keep the trailing partial for the next read.
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const parts = buffer.split('\n\n')
        buffer = parts.pop() ?? ''

        for (const part of parts) {
          const frame = parseFrame(part)
          if (!frame) continue
          let payload: unknown
          try {
            payload = JSON.parse(frame.data)
          } catch {
            continue // skip a malformed frame rather than tearing down the reply
          }
          if (!mountedRef.current) return

          if (frame.event === 'delta') {
            const { text: chunk } = payload as { text: string }
            useLeftPanelStore.getState().appendAssistantChunk(chunk)
          } else if (frame.event === 'error') {
            useLeftPanelStore
              .getState()
              .appendAssistantChunk('\n\n(The assistant could not finish this reply.)')
          }
          // `done` needs no action — the loop ends when the stream closes.
        }
      }
    } catch (err) {
      // Abort is normal (unmount) — swallow it; anything else gets a short note.
      if (err instanceof Error && err.name === 'AbortError') return
      useLeftPanelStore.getState().appendAssistantChunk('Sorry — something went wrong.')
    } finally {
      if (abortRef.current === controller) abortRef.current = null
      if (mountedRef.current) setIsStreaming(false)
    }
  }, [input, isStreaming])

  const onSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault()
      void send()
    },
    [send],
  )

  return (
    <div className="mt-6 pt-5 border-t border-line">
      {/* Transcript. One bubble per turn; the last assistant bubble grows as
          chunks arrive (append-to-last in the store). */}
      {chatMessages.length > 0 && (
        <div className="flex flex-col gap-3 mb-4">
          {chatMessages.map((m) => (
            <div
              key={m.id}
              className={
                m.role === 'user'
                  ? 'self-end max-w-[85%] bg-primary text-white rounded-2xl rounded-br-md px-4 py-2.5 text-[14px] leading-[1.5] whitespace-pre-wrap'
                  : 'self-start max-w-[85%] bg-canvas border border-line text-ink rounded-2xl rounded-bl-md px-4 py-2.5 text-[14px] leading-[1.5] whitespace-pre-wrap'
              }
            >
              {/* An empty assistant bubble means the reply hasn't started yet. */}
              {m.text.length > 0 ? m.text : <span className="text-ink-subtle">…</span>}
            </div>
          ))}
        </div>
      )}

      {ready && (
        <form onSubmit={onSubmit} className="flex items-center gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            // Disabled while a reply streams so a second question can't be fired
            // mid-response — the API is stateless and we send the whole history on
            // each call, so overlapping requests would race on the transcript.
            disabled={isStreaming}
            placeholder={isStreaming ? 'Waiting for reply…' : 'Ask about this letter…'}
            aria-label="Ask a question about this letter"
            className="flex-1 bg-canvas border border-line rounded-lg px-3.5 py-2.5 text-[14px] text-ink placeholder:text-ink-subtle focus:outline-none focus:border-primary disabled:opacity-60"
          />
          <button
            type="submit"
            disabled={isStreaming || input.trim().length === 0}
            className="btn-primary-base bg-primary text-white px-4 py-2.5 rounded-lg text-[14px] font-semibold disabled:opacity-50"
          >
            Send
          </button>
        </form>
      )}
    </div>
  )
}
