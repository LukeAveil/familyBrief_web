/**
 * POST /api/chat — the streaming chat endpoint (Next.js App Router handler).
 * ────────────────────────────────────────────────────────────────────────────
 * A parent asks follow-up questions about the letter they uploaded. This route
 * is DELIBERATELY STATELESS: it holds no session. Every request carries the full
 * context it needs — the letter summary, the extracted events, and the entire
 * turn history — and the route rebuilds the prompt from scratch each time.
 *
 * It mirrors app/api/upload/route.ts on purpose:
 *   - validate FIRST (can still reject with a real 4xx),
 *   - then return a streaming Response whose body is Server-Sent Events. Once we
 *     start streaming the HTTP status is locked to 200 (headers flush before the
 *     first byte), so any check that could reject must run before that point.
 *
 * The SSE contract the client (ChatPanel) reads:
 *   event: delta  data: {"text": "<reply chunk>"}   (0..n of these)
 *   event: done   data: {}                           (terminal success)
 *   event: error  data: {"message": "<sanitized>"}   (terminal failure)
 *
 * WHY THE CONTEXT IS SPLIT THE WAY IT IS:
 *   - The letter summary and the events go in the SYSTEM prompt. They are STABLE
 *     ground truth for the whole conversation — they don't change between turns,
 *     and the model should treat them as the authoritative source to answer from,
 *     not as something a user said that could be argued with. Putting them in
 *     `system` says exactly that: this is the world, answer within it.
 *   - The turns go in `messages`. They GROW and CHANGE every request — that's the
 *     conversation itself. They're the variable part, so they belong in the part
 *     of the request that varies.
 *
 * Full context is sent on EVERY call (the API is stateless — see above). No
 * truncation or old-turn summarisation: if a conversation ever grows long enough
 * to strain the context window, that's a real design decision worth having
 * explicitly, not something to silently paper over here.
 */

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import type { CalendarEvent } from '@/types'
import { getAnthropicClient, MODEL } from '@/lib/extract-events'

// Same budget shape as extraction; chat replies are short prose, no JSON payload.
const MAX_TOKENS = 1024

interface ChatTurn {
  role: 'user' | 'assistant'
  content: string
}

interface ChatRequestBody {
  letter: string
  events: CalendarEvent[]
  messages: ChatTurn[]
}

// Assemble the system prompt from the two pieces of stable context. Labelled as a
// SUMMARY (not the full letter) because that's what the client actually holds —
// the letter is never transcribed to text (it goes to the model as a PDF/image at
// upload time). The instruction tells the model to answer only from these sources
// and to admit when something isn't there, rather than inventing an answer.
function buildSystemPrompt(letter: string, events: CalendarEvent[]): string {
  return [
    'You are a helpful assistant answering questions about a school letter this',
    'parent has uploaded. A summary of the letter and the extracted events are',
    'provided below. Answer only from those sources. If the answer is not in them,',
    'say so honestly rather than guessing.',
    '',
    'SUMMARY OF LETTER:',
    letter || '(no summary available)',
    '',
    'EXTRACTED EVENTS:',
    JSON.stringify(events ?? [], null, 2),
  ].join('\n')
}

export async function POST(req: NextRequest) {
  // Auth gate. Same shape as /api/upload — runs before validation so an
  // anonymous request never touches the JSON body or the model. See upload
  // route for why the 401 body is plain text.
  const session = await auth()
  if (!session?.user) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  // ── Validate BEFORE streaming (see header note on the locked-200 status) ──────
  let body: ChatRequestBody
  try {
    body = (await req.json()) as ChatRequestBody
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 })
  }

  const { letter, events, messages } = body
  if (typeof letter !== 'string') {
    return NextResponse.json({ ok: false, error: 'Missing letter context' }, { status: 400 })
  }
  if (!Array.isArray(messages) || messages.length === 0) {
    return NextResponse.json({ ok: false, error: 'No messages provided' }, { status: 400 })
  }
  // The last turn must be the user's question — a stateless turn-taking sanity check.
  if (messages.at(-1)?.role !== 'user') {
    return NextResponse.json(
      { ok: false, error: 'Last message must be from the user' },
      { status: 400 },
    )
  }

  const system = buildSystemPrompt(letter, Array.isArray(events) ? events : [])

  const encoder = new TextEncoder()
  const sse = (event: string, data: unknown) =>
    encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        // Same SDK setup and model as extraction (see lib/extract-events). `system`
        // carries the stable context; `messages` is the conversation, passed verbatim.
        const chat = getAnthropicClient().messages.stream(
          {
            model: MODEL,
            max_tokens: MAX_TOKENS,
            system,
            messages: messages.map((m) => ({ role: m.role, content: m.content })),
          },
          { timeout: 30_000 },
        )

        for await (const event of chat) {
          // The SDK stream emits many event kinds; we forward only text deltas.
          if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
            controller.enqueue(sse('delta', { text: event.delta.text }))
          }
        }
        controller.enqueue(sse('done', {}))
      } catch (err) {
        // 200 + headers are already committed, so we can't switch to a 500. Deliver
        // a sanitized error in-band (never leak SDK error text) and close.
        console.error('[chat] streaming failed:', err)
        controller.enqueue(
          sse('error', { message: 'The assistant could not respond. Please try again.' }),
        )
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Content-Type-Options': 'nosniff',
      // Disable proxy/CDN buffering so reply deltas flush to the client live.
      'X-Accel-Buffering': 'no',
    },
  })
}
