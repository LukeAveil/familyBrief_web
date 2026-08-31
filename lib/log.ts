/**
 * Structured server logging.
 * ────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS: the upload route used to log exactly one line — and only when
 * the model stream threw. Every 4xx rejection (rate limit, wrong type, too large,
 * bad magic bytes) returned silently, so a failed upload showed up in the Vercel
 * dashboard as a bare status code with nothing behind it. There was no way to ask
 * "why did THIS request fail" after the fact, which is exactly the question you
 * have when a parent reports a broken upload.
 *
 * Two decisions make these logs actually usable:
 *
 * 1. ONE JSON OBJECT PER LINE. Vercel parses JSON log lines into structured
 *    fields, so `event:"truncated"` becomes something you can filter on rather
 *    than a string you have to grep. Interpolated prose ("upload failed: ...")
 *    reads fine to a human and is useless to a query.
 *
 * 2. THE REQUEST ID IS ALWAYS PRESENT. Vercel stamps `x-vercel-id` on the request
 *    and shows that same value in the dashboard as "Request ID". Carrying it into
 *    every line is what lets you go from a dashboard entry to the log lines for
 *    that exact request — the link that was missing when the original truncation
 *    bug was reported.
 *
 * ─── PRIVACY: READ BEFORE ADDING A FIELD ─────────────────────────────────────
 * The payloads here are letters about named children. A log drain is not a safe
 * place for that, so these logs record SHAPE, never CONTENT:
 *
 *   - No filenames. "Tommy-Smith-permission-slip.pdf" identifies a child.
 *   - No file bytes or base64, not even a prefix.
 *   - No extracted events. Titles, dates, and locations describe where a specific
 *     child will be. Log `eventCount`; never the events themselves.
 *   - No summary or chat text.
 *
 * Sizes, MIME types, counts, token totals, and durations are all fine — they
 * describe the request without describing the family.
 *
 * (Raw SDK error text may go here. The rule that it must never reach the CLIENT
 * is unchanged; the whole point of a server log is to hold what the client can't
 * be shown.)
 */

/** Which endpoint a line came from, so one drain can serve both routes. */
export type LogSource = 'upload' | 'chat'

/**
 * Read Vercel's request ID off the incoming request.
 *
 * `x-vercel-id` is injected by the platform and matches the "Request ID" shown in
 * the dashboard. Off-platform (local dev, tests) the header is absent, so we fall
 * back to a constant rather than inventing an ID — a random one would imply a
 * correlation that doesn't exist anywhere.
 */
export function requestId(headers: Headers): string {
  return headers.get('x-vercel-id') ?? 'local'
}

/**
 * Emit one structured line.
 *
 * `level` maps onto console methods because Vercel derives its log level from
 * them — using `error` for failures is what makes the dashboard's level filter
 * work. Fields are spread last so a caller can always see what it's adding.
 */
export function createLogger(src: LogSource, reqId: string) {
  return function log(
    level: 'log' | 'error',
    event: string,
    fields: Record<string, unknown> = {},
  ): void {
    console[level](JSON.stringify({ src, event, reqId, ...fields }))
  }
}

export type Logger = ReturnType<typeof createLogger>
