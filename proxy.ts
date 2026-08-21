/**
 * proxy.ts — the workspace-gating proxy (Next.js 16 replacement for middleware).
 * ────────────────────────────────────────────────────────────────────────────
 * WHY proxy.ts, NOT middleware.ts
 *   Next.js 16 renamed the file convention: `middleware.ts` is deprecated and
 *   the same code lives in `proxy.ts` with an exported `proxy` function. Same
 *   semantics, but the runtime is now fixed to Node.js (you cannot set edge),
 *   which is exactly what we want — @auth/pg-adapter uses `pg`, and `pg` does
 *   not run on edge. See node_modules/next/dist/docs/01-app/03-api-reference/
 *   03-file-conventions/proxy.md line 223.
 *
 * WHY THIS FILE ONLY CHECKS COOKIE PRESENCE, NOT SESSION VALIDITY
 *   Next 16 docs are explicit: "Always verify authentication and authorization
 *   inside each Server Function rather than relying on Proxy alone" (proxy.md
 *   line 219). Two reasons:
 *     1. Perf. If we called auth() here, every request — including retries and
 *        client re-navigations — would round-trip to Postgres just to know
 *        whether to render or redirect. Cookie-presence-only is ~free.
 *     2. Correctness. Proxy runs before request-scoped code; it can't reliably
 *        share DB state with the server component that will render next. The
 *        authoritative check belongs where the data is used.
 *   So this proxy is a *hint*: if the session cookie is missing, the user
 *   almost certainly isn't signed in — bounce them to /signin before we
 *   bother loading the workspace bundle. If the cookie is present but stale
 *   or forged, the server component's `await auth()` catches it and redirects
 *   there instead (see app/page.tsx).
 *
 * WHY EXPLICIT MATCHER FOR /, NOT NEGATIVE MATCH FOR EVERYTHING
 *   The app has exactly one workspace route today (/). An allowlist matcher
 *   is smaller, more auditable, and cannot accidentally block a new /api
 *   route or static asset. When we add a second workspace route (e.g.
 *   /workspace/[id]), add it to `config.matcher` here — that's the single
 *   coordinated change.
 *
 * COOKIE NAMES
 *   Auth.js uses `authjs.session-token` in dev (HTTP) and
 *   `__Secure-authjs.session-token` in prod (HTTPS, cookie prefix per RFC).
 *   We check both because NODE_ENV is a poor signal for "am I on HTTPS" —
 *   a preview deploy on HTTPS in dev mode would need the secure name.
 */

import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

const SESSION_COOKIE_NAMES = ['authjs.session-token', '__Secure-authjs.session-token']

export function proxy(request: NextRequest): NextResponse {
  const hasSession = SESSION_COOKIE_NAMES.some((name) => request.cookies.get(name))
  if (hasSession) {
    return NextResponse.next()
  }

  // Preserve the requested URL so /signin can send the user back after
  // clicking the magic link. We pass just pathname + search — never the full
  // URL — so an attacker cannot craft an open-redirect to a foreign origin.
  const url = new URL('/signin', request.url)
  url.searchParams.set('callbackUrl', request.nextUrl.pathname + request.nextUrl.search)
  return NextResponse.redirect(url)
}

export const config = {
  // Match only routes that host the workspace UI. /api/auth/* is intentionally
  // NOT matched — Auth.js needs to accept unauthenticated requests there (the
  // magic-link click, sign-in POSTs) to establish the session in the first
  // place. Adding paths here later is how new gated routes are wired.
  matcher: ['/'],
}
