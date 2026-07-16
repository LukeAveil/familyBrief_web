/**
 * @jest-environment node
 */

/**
 * Unit tests for `sanitizeLevel` — the confidence coercion seam.
 * ────────────────────────────────────────────────────────────────────────────
 * WHY THIS FILE EXISTS (and doesn't duplicate extract-events.test.ts):
 * extract-events.test.ts already exercises confidence end-to-end through
 * `extractEventsFromFile` (passthrough of high/medium/low, medium fallback for a
 * bogus value, omission of location confidence). Those are integration-flavoured:
 * they route through JSON parsing and the whole mapper.
 *
 * This file tests the coercion function in ISOLATION, because it is the single
 * point where untrusted model output ('high' | garbage | undefined | a number)
 * is turned into a value the UI renders as a trust signal. The specific property
 * that matters — invalid input must default to 'medium', never 'high' — is a
 * one-line rule that is easy to break in a refactor and that the type checker
 * cannot protect (the input is `unknown` by design, because it comes off the
 * wire). A direct test pins the contract at the smallest possible unit.
 */

import { sanitizeLevel } from '@/lib/extract-events'

describe('sanitizeLevel', () => {
  it('passes through the two explicit non-default levels', () => {
    // 'high' and 'low' are the values a caller must be able to trust verbatim.
    expect(sanitizeLevel('high')).toBe('high')
    expect(sanitizeLevel('low')).toBe('low')
  })

  it("returns 'medium' for the literal 'medium'", () => {
    // 'medium' is valid input but also the default, so it takes the same path as
    // anything unrecognised. Asserted explicitly so the intent is documented.
    expect(sanitizeLevel('medium')).toBe('medium')
  })

  // The core safety property: every kind of invalid input collapses to 'medium'
  // — the "flag it for a second look" default — and NEVER to the falsely
  // reassuring 'high'. Table-driven so new junk inputs are cheap to add.
  it.each([
    ['undefined', undefined],
    ['null', null],
    ['an empty string', ''],
    ['an unknown string', 'bogus'],
    ['a number', 3],
    ['a boolean', true],
    ['an object', { level: 'high' }],
    ['the wrong case', 'HIGH'],
  ])('defaults %s to medium (honest fallback, never high)', (_label, input) => {
    expect(sanitizeLevel(input)).toBe('medium')
  })
})
