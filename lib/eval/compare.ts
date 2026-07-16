/**
 * Structural comparison for the AI eval harness.
 * ────────────────────────────────────────────────────────────────────────────
 * `compareExtraction` diffs what the live model actually produced (a
 * `CalendarEvent[]`) against the fixture's ground truth (an `ExpectedEvent[]`)
 * and returns a *structured* result — a per-event, per-field breakdown plus a
 * single 0–100 score.
 *
 * WHY STRUCTURAL, NOT MODEL-GRADED: the obvious alternative is to ask another
 * model "how close are these?". We deliberately don't. A model grader is itself
 * non-deterministic, adds cost and latency, and — worst for an eval whose job is
 * regression detection — can drift independently of the thing under test, so a
 * score change no longer tells you cleanly whether the *extraction* changed. A
 * pure function over the fields we care about is deterministic, free, fast, and
 * its verdict is inspectable line by line. The trade-off is that it only grades
 * the dimensions we encode here (title, timed-ness, location, per-field
 * confidence); it can't judge, say, whether a description is well written. That
 * is an accepted limit — those are exactly the dimensions a prompt/model change
 * would regress.
 *
 * WHY POSITIONAL MATCHING: events are compared index-to-index (actual[0] vs
 * expected[0], …). We intentionally do NOT attempt fuzzy pairing (nearest title,
 * best-fit assignment). Fuzzy pairing hides failures — a dropped or reordered
 * event gets quietly re-aligned and the diff looks healthier than reality.
 * Positional keeps the comparison honest: if the model emits events in a
 * different order or the wrong count, that shows up as misses, which is the
 * signal we want. `eventCountMatch` flags length disagreement explicitly.
 */

import type { CalendarEvent, ConfidenceLevel } from '@/types'
import type { ExpectedEvent } from '@/__tests__/fixtures/school-messages'

// ─── Result shape ────────────────────────────────────────────────────────────

export type TitleMatch = 'exact' | 'close' | 'miss'
export type LocationMatch = 'exact' | 'both-null' | 'miss'
export type ConfidenceFieldMatch = 'exact' | 'off-by-one' | 'miss' | 'n/a'

export interface EventComparison {
  /** Whether this positional pair matched well enough overall. Derived: true
   *  when every graded field is its best value (title exact, timed match,
   *  location exact-or-both-null, all confidence fields exact). */
  matched: boolean
  titleMatch: TitleMatch
  timedMatch: boolean
  locationMatch: LocationMatch
  confidenceMatch: {
    title: ConfidenceFieldMatch
    datetime: ConfidenceFieldMatch
    location: ConfidenceFieldMatch
  }
}

export interface ComparisonResult {
  /** True when actual and expected have the same number of events. */
  eventCountMatch: boolean
  /** One entry per positionally-matched pair (i.e. min(actual, expected) long).
   *  Extra events on either side are unmatched and are reflected only in the
   *  score, which divides by the LARGER count. */
  events: EventComparison[]
  /** Simple 0–100 aggregate. See `scoreFrom` for the formula. */
  score: number
}

// ─── Matchers ────────────────────────────────────────────────────────────────

/** Normalise a title for the `close` comparison: lower-cased, whitespace
 *  collapsed and trimmed, and trailing punctuation (. , ! ? ; :) stripped. This
 *  is what lets "Autumn Fair" match "autumn fair." without counting as exact. */
function normalizeTitle(s: string): string {
  return s
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.,!?;:]+$/, '')
}

/** Title matcher.
 *  - `exact` = strings are byte-for-byte equal.
 *  - `close` = equal after normalisation (case, whitespace, trailing punct).
 *  - `miss`  = neither. */
function matchTitle(actual: string, expected: string): TitleMatch {
  if (actual === expected) return 'exact'
  if (normalizeTitle(actual) === normalizeTitle(expected)) return 'close'
  return 'miss'
}

/** Location matcher.
 *  - `both-null` = neither side has a location. This is a CORRECT outcome (the
 *    model rightly declined to invent one), not a miss — grading it as a miss
 *    would punish the pipeline for being honest.
 *  - `exact`     = both present and equal after case/whitespace normalisation.
 *  - `miss`      = one present and the other not, or both present but different. */
function matchLocation(actual: string | null, expected: string | null): LocationMatch {
  if (actual === null && expected === null) return 'both-null'
  if (actual !== null && expected !== null) {
    const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim()
    return norm(actual) === norm(expected) ? 'exact' : 'miss'
  }
  return 'miss'
}

// Confidence levels laid out on a line so "distance" is well-defined:
//   high(0) — medium(1) — low(2)
const CONFIDENCE_ORDER: Record<ConfidenceLevel, number> = { high: 0, medium: 1, low: 2 }

/** Confidence matcher for a single field.
 *  - `n/a`        = both sides omit this field (e.g. no location → no location
 *    confidence). Nothing to grade; excluded from the score entirely.
 *  - `miss`       = exactly one side has the field. Disagreeing about WHETHER a
 *    field exists is a real mismatch, not a near-miss.
 *  - `exact`      = same level.
 *  - `off-by-one` = one step apart on the high–medium–low line. This is called
 *    out separately because a one-step drift (high vs medium) is a qualitatively
 *    different, much less alarming failure than getting it completely wrong.
 *  - `miss`       = two steps apart (high vs low). */
function matchConfidence(
  actual: ConfidenceLevel | undefined,
  expected: ConfidenceLevel | undefined,
): ConfidenceFieldMatch {
  if (actual === undefined && expected === undefined) return 'n/a'
  if (actual === undefined || expected === undefined) return 'miss'
  const distance = Math.abs(CONFIDENCE_ORDER[actual] - CONFIDENCE_ORDER[expected])
  if (distance === 0) return 'exact'
  if (distance === 1) return 'off-by-one'
  return 'miss'
}

// ─── Scoring ─────────────────────────────────────────────────────────────────
//
// Formula (deliberately simple and documented — the exact numbers matter less
// than being consistent across runs so scores are comparable over time):
//
//   • Each graded field yields a fraction in [0, 1]:
//       title:      exact = 1,  close = 0.5,        miss = 0
//       timed:      match = 1,  else 0
//       location:   exact = 1,  both-null = 1,      miss = 0
//       confidence: exact = 1,  off-by-one = 0.5,   miss = 0   (n/a excluded)
//   • An event's score = mean of its graded fields (n/a confidence fields are
//     dropped from the mean, so an event without a location isn't penalised for
//     lacking a location-confidence field).
//   • Overall score = mean of event scores, but divided by max(actual, expected)
//     rather than the matched count — so a count mismatch drags the score down
//     (each unmatched slot contributes 0). Then ×100.

const TITLE_POINTS: Record<TitleMatch, number> = { exact: 1, close: 0.5, miss: 0 }
const LOCATION_POINTS: Record<LocationMatch, number> = { exact: 1, 'both-null': 1, miss: 0 }
const CONFIDENCE_POINTS: Record<Exclude<ConfidenceFieldMatch, 'n/a'>, number> = {
  exact: 1,
  'off-by-one': 0.5,
  miss: 0,
}

function eventScore(c: EventComparison): number {
  const fields: number[] = [
    TITLE_POINTS[c.titleMatch],
    c.timedMatch ? 1 : 0,
    LOCATION_POINTS[c.locationMatch],
  ]
  // Confidence sub-fields each count as their own field; 'n/a' ones are skipped
  // so they neither help nor hurt.
  for (const m of Object.values(c.confidenceMatch)) {
    if (m !== 'n/a') fields.push(CONFIDENCE_POINTS[m])
  }
  return fields.reduce((a, b) => a + b, 0) / fields.length
}

function scoreFrom(events: EventComparison[], actualLen: number, expectedLen: number): number {
  const denom = Math.max(actualLen, expectedLen)
  if (denom === 0) return 100 // both empty and equal → a perfect (if trivial) match
  const total = events.reduce((sum, c) => sum + eventScore(c), 0)
  return Math.round((total / denom) * 100)
}

// ─── Public entry point ──────────────────────────────────────────────────────

/**
 * Compare a live extraction against fixture ground truth. Pure: same inputs
 * always give the same result, so the score is a stable regression signal.
 */
export function compareExtraction(
  actual: CalendarEvent[],
  expected: ExpectedEvent[],
): ComparisonResult {
  const pairCount = Math.min(actual.length, expected.length)
  const events: EventComparison[] = []

  for (let i = 0; i < pairCount; i++) {
    const a = actual[i]
    const e = expected[i]

    const titleMatch = matchTitle(a.title, e.title)
    const timedMatch = (a.time !== null) === e.timed
    const locationMatch = matchLocation(a.location, e.location)
    const confidenceMatch = {
      title: matchConfidence(a.confidence.title, e.confidence.title),
      datetime: matchConfidence(a.confidence.datetime, e.confidence.datetime),
      location: matchConfidence(a.confidence.location, e.confidence.location),
    }

    // A pair "matched" only if every graded dimension is at its best value.
    const matched =
      titleMatch === 'exact' &&
      timedMatch &&
      (locationMatch === 'exact' || locationMatch === 'both-null') &&
      confidenceMatch.title !== 'off-by-one' &&
      confidenceMatch.title !== 'miss' &&
      confidenceMatch.datetime !== 'off-by-one' &&
      confidenceMatch.datetime !== 'miss' &&
      confidenceMatch.location !== 'off-by-one' &&
      confidenceMatch.location !== 'miss'

    events.push({ matched, titleMatch, timedMatch, locationMatch, confidenceMatch })
  }

  return {
    eventCountMatch: actual.length === expected.length,
    events,
    score: scoreFrom(events, actual.length, expected.length),
  }
}
