/**
 * @jest-environment node
 */

/**
 * Unit tests for `compareExtraction` — the eval's structural diff.
 * ────────────────────────────────────────────────────────────────────────────
 * This is exactly the "logic where a subtle bug silently breaks the whole thing"
 * that the phase-one harness says to unit-test. The comparison function is the
 * scorekeeper for the entire AI eval: if a matcher is wrong, every eval run
 * reports a plausible-looking-but-false score, and a real regression could sail
 * through green. None of that is caught by types (the shapes stay valid) — only
 * by pinning the matcher rules directly.
 *
 * Each test names the regression it guards against.
 */

import { compareExtraction } from '@/lib/eval/compare'
import type { CalendarEvent } from '@/types'
import type { ExpectedEvent } from '@/__tests__/fixtures/school-messages'

// ─── Builders ────────────────────────────────────────────────────────────────
// Minimal factories so each test states only the fields it cares about; the rest
// default to a benign, fully-matching baseline.

function actual(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: 1,
    title: 'Autumn Fair',
    date: 'Saturday, 7 November 2026',
    time: '11:00 AM',
    location: 'the playground',
    notes: null,
    cal: '20261107T110000/20261107T140000',
    confidence: { title: 'high', datetime: 'high', location: 'high' },
    ...overrides,
  }
}

function expected(overrides: Partial<ExpectedEvent> = {}): ExpectedEvent {
  return {
    title: 'Autumn Fair',
    timed: true,
    location: 'the playground',
    confidence: { title: 'high', datetime: 'high', location: 'high' },
    ...overrides,
  }
}

describe('compareExtraction', () => {
  it('reports a perfect match with score 100', () => {
    // Regression guard: the happy path must actually reach 100. If it can't, the
    // scoring is mis-weighted and every real run reads low for no reason.
    const result = compareExtraction([actual()], [expected()])
    expect(result.eventCountMatch).toBe(true)
    expect(result.score).toBe(100)
    expect(result.events[0].matched).toBe(true)
    expect(result.events[0].titleMatch).toBe('exact')
    expect(result.events[0].confidenceMatch).toEqual({
      title: 'exact',
      datetime: 'exact',
      location: 'exact',
    })
  })

  it('flags an event-count mismatch and still scores what it can', () => {
    // Regression guard: a dropped event must NOT be hidden. eventCountMatch goes
    // false, only the positional pair is compared, and the missing slot pulls the
    // score below 100 (denominator is the larger count).
    const result = compareExtraction([actual()], [expected(), expected()])
    expect(result.eventCountMatch).toBe(false)
    expect(result.events).toHaveLength(1) // only the pair that exists
    expect(result.score).toBeLessThan(100)
    expect(result.score).toBe(50) // one perfect event out of two slots
  })

  it("treats a byte-equal title as 'exact'", () => {
    const result = compareExtraction(
      [actual({ title: 'Sports Day' })],
      [expected({ title: 'Sports Day' })],
    )
    expect(result.events[0].titleMatch).toBe('exact')
  })

  it("treats case/whitespace/trailing-punct differences as 'close', not 'miss'", () => {
    // Regression guard for the normaliser: "autumn fair." must be 'close' to
    // "Autumn Fair". If this collapses to 'miss', cosmetic title variance would
    // be scored as an outright wrong answer and mask nothing/over-penalise.
    const result = compareExtraction(
      [actual({ title: '  autumn   fair. ' })],
      [expected({ title: 'Autumn Fair' })],
    )
    expect(result.events[0].titleMatch).toBe('close')
  })

  it("treats an unrelated title as 'miss'", () => {
    const result = compareExtraction(
      [actual({ title: 'Nativity Play' })],
      [expected({ title: 'Autumn Fair' })],
    )
    expect(result.events[0].titleMatch).toBe('miss')
  })

  it("scores a one-step confidence drift as 'off-by-one', not 'miss'", () => {
    // Regression guard: high-vs-medium is the whole reason off-by-one exists. It
    // must be distinguished from a two-step error so a small drift reads as a
    // small drift, not a total failure.
    const result = compareExtraction(
      [actual({ confidence: { title: 'medium', datetime: 'high', location: 'high' } })],
      [expected({ confidence: { title: 'high', datetime: 'high', location: 'high' } })],
    )
    expect(result.events[0].confidenceMatch.title).toBe('off-by-one')
  })

  it("scores a two-step confidence gap (high vs low) as 'miss'", () => {
    // The boundary case that makes off-by-one meaningful: high↔low is two steps
    // and must be a full miss, never off-by-one.
    const result = compareExtraction(
      [actual({ confidence: { title: 'low', datetime: 'high', location: 'high' } })],
      [expected({ confidence: { title: 'high', datetime: 'high', location: 'high' } })],
    )
    expect(result.events[0].confidenceMatch.title).toBe('miss')
  })

  it("treats a correctly-absent location as 'both-null', a full-credit outcome", () => {
    // Regression guard: an event with no location, matched to an expected event
    // with no location, is CORRECT. If this were graded 'miss', the pipeline would
    // be punished for honestly declining to invent a location.
    const noLoc = actual({
      location: null,
      time: null, // on a CalendarEvent, a null time IS the all-day signal
      confidence: { title: 'high', datetime: 'high' },
    })
    const result = compareExtraction(
      [noLoc],
      [expected({ location: null, timed: false, confidence: { title: 'high', datetime: 'high' } })],
    )
    expect(result.events[0].locationMatch).toBe('both-null')
    expect(result.events[0].confidenceMatch.location).toBe('n/a')
    expect(result.score).toBe(100) // both-null and n/a give full credit
  })

  it("marks a location present on one side only as a 'miss'", () => {
    // Disagreeing about whether a location exists is a real error, distinct from
    // both-null. Confidence location likewise mismatches (present vs absent).
    const result = compareExtraction(
      [actual({ location: null, confidence: { title: 'high', datetime: 'high' } })],
      [expected({ location: 'School Hall' })],
    )
    expect(result.events[0].locationMatch).toBe('miss')
    expect(result.events[0].confidenceMatch.location).toBe('miss')
  })

  it('flags a timed-vs-all-day disagreement', () => {
    // A timed event scored against an all-day expectation (or vice-versa) is a
    // real extraction error the parent would feel; timedMatch must catch it.
    const result = compareExtraction([actual({ time: null })], [expected({ timed: true })])
    expect(result.events[0].timedMatch).toBe(false)
  })

  it('scores an all-miss event near zero', () => {
    // Regression guard: when nothing matches, the score must reflect that. Title
    // miss (0), timed mismatch (0), location miss (0), all confidence miss (0)
    // → an event score of 0.
    const wrong: CalendarEvent = actual({
      title: 'Totally Different',
      time: null, // vs expected timed:true → mismatch
      location: 'Somewhere Else',
      confidence: { title: 'low', datetime: 'low', location: 'low' },
    })
    const result = compareExtraction([wrong], [expected()]) // expected: high/high/high, timed, "the playground"
    expect(result.events[0].titleMatch).toBe('miss')
    expect(result.events[0].timedMatch).toBe(false)
    expect(result.events[0].locationMatch).toBe('miss')
    expect(result.events[0].confidenceMatch.title).toBe('miss')
    expect(result.score).toBe(0)
    expect(result.events[0].matched).toBe(false)
  })

  it('returns 100 for two empty arrays (trivial but valid match)', () => {
    // Edge case: no events expected and none produced is a correct outcome, not a
    // divide-by-zero or a NaN score.
    const result = compareExtraction([], [])
    expect(result.eventCountMatch).toBe(true)
    expect(result.events).toHaveLength(0)
    expect(result.score).toBe(100)
  })
})
