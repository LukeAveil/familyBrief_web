/**
 * AI eval runner — run it, print it, write it.
 * ────────────────────────────────────────────────────────────────────────────
 * For each fixture in SCHOOL_MESSAGE_FIXTURES this script sends the *source
 * letter* to the LIVE Claude API, structurally compares the result against the
 * fixture's ground truth, prints a human-readable report, and writes the raw
 * results to eval-results/{timestamp}.json.
 *
 * WHY LIVE API, NOT THE MOCK: the integration test
 * (__tests__/integration/) mocks the SDK so it's deterministic and free — its
 * job is to prove our *code* composes. This eval has the opposite job: prove the
 * *model + prompt* still extract the right events. Mocking the model here would
 * be grading our own answer key. So the eval deliberately spends real credits
 * and talks to the real model. That's also why it is NOT in `npm test` or CI —
 * it's on-demand only (`npm run eval`), run by a human who wants to see drift.
 *
 * WHY WRITE JSON: stdout is for the human reading this run. The JSON file is for
 * comparing runs *over time* — after a prompt tweak or a model bump, diff
 * today's file against last week's and the score/field changes are right there.
 * The eval's real value is regression detection, and that needs a durable record
 * per run, not just a number on screen.
 *
 * Kept deliberately dumb: no CLI args, no dry-run, no fancy formatting. It's a
 * script, not a framework.
 */

import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { extractEventsFromText } from '@/lib/extract-events'
import { compareExtraction, type ComparisonResult } from '@/lib/eval/compare'
import { SCHOOL_MESSAGE_FIXTURES } from '@/__tests__/fixtures/school-messages'

// The pipeline reads ANTHROPIC_API_KEY from the environment. A standalone script
// (unlike the Next.js app) doesn't auto-load .env.local, so pull it in here.
// Guarded because the key may already be exported in the shell.
if (!process.env.ANTHROPIC_API_KEY) {
  try {
    process.loadEnvFile('.env.local')
  } catch {
    // No .env.local — that's fine as long as the key is exported some other way.
  }
}

if (!process.env.ANTHROPIC_API_KEY) {
  console.error(
    'ANTHROPIC_API_KEY is not set. Add it to .env.local or export it, then re-run `npm run eval`.',
  )
  process.exit(1)
}

/** The per-fixture record we print AND persist. */
interface FixtureResult {
  name: string
  description: string
  comparison: ComparisonResult
  /** Populated instead of `comparison` if the live call itself threw. */
  error?: string
}

// ─── Formatting helpers (stdout only) ────────────────────────────────────────

const line = (s = '') => console.log(s)

function reportFixture(r: FixtureResult): void {
  line()
  line(`── ${r.name} ${'─'.repeat(Math.max(0, 60 - r.name.length))}`)
  line(`   ${r.description}`)

  if (r.error) {
    line(`   ✗ ERROR: ${r.error}`)
    return
  }

  const c = r.comparison
  line(`   event count: ${c.eventCountMatch ? '✓ match' : '✗ MISMATCH'}`)
  c.events.forEach((e, i) => {
    // One line per event: the four field verdicts at a glance, then the three
    // confidence sub-verdicts. Compact on purpose so a whole run scans quickly.
    const conf = `title=${e.confidenceMatch.title} datetime=${e.confidenceMatch.datetime} location=${e.confidenceMatch.location}`
    line(
      `   event ${i}: ${e.matched ? '✓' : '·'} ` +
        `title=${e.titleMatch} timed=${e.timedMatch ? 'ok' : 'MISS'} location=${e.locationMatch} | confidence[${conf}]`,
    )
  })
  line(`   score: ${c.score}/100`)
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  line('Running AI eval against the LIVE Claude API…')
  line(`Fixtures: ${SCHOOL_MESSAGE_FIXTURES.length}`)

  const results: FixtureResult[] = []

  // Sequential, not parallel: keeps output readable and avoids hammering the API
  // with a burst. The fixture set is small, so wall-clock isn't a concern.
  for (const fixture of SCHOOL_MESSAGE_FIXTURES) {
    try {
      const actual = await extractEventsFromText(fixture.sourceLetter)
      const comparison = compareExtraction(actual, fixture.expected.events)
      results.push({ name: fixture.name, description: fixture.description, comparison })
    } catch (err) {
      // A single fixture failing (network, parse, rate limit) shouldn't abort the
      // whole run — record it and move on so the other fixtures still report.
      results.push({
        name: fixture.name,
        description: fixture.description,
        comparison: { eventCountMatch: false, events: [], score: 0 },
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  // ── Per-fixture reports ──
  results.forEach(reportFixture)

  // ── Summary ──
  const scored = results.filter((r) => !r.error)
  const clean = scored.filter((r) => r.comparison.score === 100)
  const drifted = scored.filter((r) => r.comparison.score < 100)
  const errored = results.filter((r) => r.error)
  const avg =
    scored.length > 0
      ? Math.round(scored.reduce((s, r) => s + r.comparison.score, 0) / scored.length)
      : 0

  line()
  line('═'.repeat(64))
  line(`SUMMARY   average score: ${avg}/100   (${scored.length} scored, ${errored.length} errored)`)
  line(`  clean (100):  ${clean.map((r) => r.name).join(', ') || '—'}`)
  line(
    `  drifted:      ${drifted.map((r) => `${r.name} (${r.comparison.score})`).join(', ') || '—'}`,
  )
  if (errored.length) line(`  errored:      ${errored.map((r) => r.name).join(', ')}`)
  line('═'.repeat(64))

  // ── Persist raw results ──
  // Colons are stripped from the ISO timestamp so the filename is safe on every
  // filesystem (Windows rejects ':'); the value is still sortable.
  const stamp = new Date().toISOString().replace(/:/g, '-')
  const dir = join(process.cwd(), 'eval-results')
  mkdirSync(dir, { recursive: true })
  const outPath = join(dir, `${stamp}.json`)
  writeFileSync(outPath, JSON.stringify({ timestamp: stamp, average: avg, results }, null, 2))
  line()
  line(`Raw results written to ${outPath}`)
}

main().catch((err) => {
  // Unexpected top-level failure (not a per-fixture one) — surface and exit non-zero.
  console.error(err)
  process.exit(1)
})
