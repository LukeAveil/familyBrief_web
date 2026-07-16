/**
 * Unit tests for `parseFrame` — the client-side SSE frame parser.
 * ────────────────────────────────────────────────────────────────────────────
 * WHY THIS FILE EXISTS:
 * The streaming state on the client is split in two: the byte-buffering read loop
 * (which splits the response body into frames) and `parseFrame` (which turns one
 * frame's text into { event, data }). The full loop is covered by the heavy
 * ScreenRouter.test.tsx, which drives a real File through fetch-mocked SSE. But
 * that test is slow, DOM-heavy, and when it fails it doesn't tell you WHICH layer
 * broke. `parseFrame` is pure string-in/object-out, so it deserves direct unit
 * tests: a regression in this parser (mis-slicing a prefix, dropping multi-line
 * data) would silently corrupt every streamed event, and the type checker sees
 * only `string -> object | null`, so it cannot catch any of it.
 *
 * Note: this imports from a 'use client' component module, so we run under the
 * default jsdom environment (no `@jest-environment node` docblock). Only the
 * pure exported helper is exercised — the component itself is never rendered.
 */

import { parseFrame } from '@/components/ScreenRouter'

describe('parseFrame', () => {
  it('parses an event line and a data line into { event, data }', () => {
    const frame = 'event: delta\ndata: {"text":"hello"}'
    expect(parseFrame(frame)).toEqual({ event: 'delta', data: '{"text":"hello"}' })
  })

  it("defaults the event name to 'message' when no event line is present", () => {
    // Per the SSE spec a frame may omit the event line; consumers then treat it
    // as the default 'message' event. The parser must honour that rather than
    // returning something falsy the caller would misroute.
    expect(parseFrame('data: {"ok":true}')).toEqual({ event: 'message', data: '{"ok":true}' })
  })

  it('joins multiple data lines with newlines (multi-line payloads)', () => {
    // SSE allows a payload to span several `data:` lines; the real value is their
    // newline-join. JSON summaries can legitimately contain newlines, so getting
    // this wrong would truncate or mangle a streamed event.
    const frame = 'event: done\ndata: line one\ndata: line two'
    expect(parseFrame(frame)).toEqual({ event: 'done', data: 'line one\nline two' })
  })

  it('returns null when the frame has no data line', () => {
    // A frame with only an event line (or only blank/comment lines) carries no
    // payload. Returning null — rather than { event, data: '' } — lets the read
    // loop skip it instead of trying to JSON.parse an empty string.
    expect(parseFrame('event: ping')).toBeNull()
    expect(parseFrame(': this is an SSE comment')).toBeNull()
    expect(parseFrame('')).toBeNull()
  })

  it('trims only the leading space after the colon, not internal whitespace', () => {
    // The SSE format is `data:<space><payload>`; exactly one optional leading
    // space is stripped. Internal spaces in the payload must survive so JSON like
    // `{"a": 1}` round-trips intact.
    expect(parseFrame('data: {"a": 1}')?.data).toBe('{"a": 1}')
  })

  it('ignores lines that are neither event nor data', () => {
    // Unknown SSE fields (id:, retry:, comments) must not corrupt the parse.
    const frame = 'id: 42\nevent: delta\nretry: 3000\ndata: payload'
    expect(parseFrame(frame)).toEqual({ event: 'delta', data: 'payload' })
  })
})
