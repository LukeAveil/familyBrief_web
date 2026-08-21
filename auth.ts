/**
 * auth.ts — Auth.js v5 configuration for FamilyBrief.
 * ────────────────────────────────────────────────────────────────────────────
 * Auth.js v5 convention: one file at the project root that calls NextAuth()
 * and re-exports the four things every other file needs:
 *   - auth      → the universal server-side session-getter (used in server
 *                 components, route handlers, and proxy.ts)
 *   - handlers  → { GET, POST } to mount at /api/auth/[...nextauth]/route.ts
 *   - signIn    → programmatic sign-in (used from the /signin server action)
 *   - signOut   → programmatic sign-out (deferred UI in Stage 1; still exported
 *                 so it can be wired to a sign-out button later without
 *                 changing this file)
 *
 * WHY SESSION STRATEGY "database", NOT "jwt"
 *   With "jwt", the session lives entirely in a signed cookie: no DB round-trip
 *   on every auth() call, no way to *revoke* a session without an external
 *   allowlist/denylist, and no server-side place to hang per-session metadata
 *   (device, IP, "last active"). With "database", every auth() call issues
 *   `select * from sessions where "sessionToken" = $1` — one extra query per
 *   authenticated request. In exchange we get real revocation (delete the
 *   row), authoritative expiry (server, not signed client claim), and a
 *   natural home for the persistence work in Stage 2. We're building on top of
 *   sessions; making them a first-class DB entity now is the right primitive.
 *
 * WHY PASS THE POOL LAZILY
 *   `getPool()` reads SUPABASE_DB_URL on first call. If we passed `pool` at
 *   module load, importing this file (which happens in tests, in the Next.js
 *   type-check pass, in eslint's parser) would crash whenever the env var
 *   isn't set. Deferring to first-use lets tools import the module freely.
 *
 * WHY pages.signIn: "/signin"
 *   Overrides Auth.js's default /api/auth/signin page. When a signed-out user
 *   hits a gated route, both the proxy and any auth()-guarded server component
 *   send them to /signin?callbackUrl=<original>. Keeping the route custom lets
 *   us own the UX (states, copy, styling) — Auth.js's built-in page is a
 *   generic scaffold, not something we'd ship.
 *
 * WHY NO providers.Resend({ apiKey })
 *   Auth.js v5 auto-reads AUTH_<PROVIDER>_KEY (and AUTH_<PROVIDER>_ID/SECRET
 *   for OAuth). AUTH_RESEND_KEY is picked up without us having to name it
 *   here. AUTH_SECRET is likewise auto-read for cookie/CSRF signing (yes,
 *   even in database session mode — the *cookie* still needs a signature so
 *   it can't be forged on the way in).
 */

import NextAuth from 'next-auth'
import Resend from 'next-auth/providers/resend'
import PostgresAdapter from '@auth/pg-adapter'
import { getPool } from '@/lib/db'

export const { auth, handlers, signIn, signOut } = NextAuth(() => ({
  // Adapter is constructed inside the config factory so getPool() runs at
  // request time, not import time. See "WHY PASS THE POOL LAZILY" above.
  adapter: PostgresAdapter(getPool()),

  session: {
    strategy: 'database',
    // 30 days. Sessions extend on each auth() call (Auth.js default), so an
    // active user stays signed in indefinitely; an idle user is signed out
    // after 30 days without activity. Adjust once we see actual usage patterns.
    maxAge: 60 * 60 * 24 * 30,
  },

  providers: [
    Resend({
      // The From address MUST be a domain you own and verified in Resend
      // (Resend rejects unverified senders). Pin via env so staging/prod can
      // use different domains without touching this file.
      from: process.env.AUTH_EMAIL_FROM,
      // apiKey is inferred from AUTH_RESEND_KEY — see the header comment.
    }),
  ],

  pages: {
    signIn: '/signin',
    // Auth.js default for `verifyRequest` (the "check your inbox" page it
    // redirects to after `signIn("resend", { email })`) is fine to leave as
    // the built-in — we render our own success state in-page instead of
    // redirecting to a separate URL. See app/signin/page.tsx.
  },
}))
