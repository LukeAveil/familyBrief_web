/**
 * Auth.js catch-all route handler.
 * ────────────────────────────────────────────────────────────────────────────
 * Auth.js needs a mounted HTTP endpoint for the browser to hit — Resend's
 * magic-link URLs point here (/api/auth/callback/resend?token=...), and the
 * `signIn`/`signOut` server actions POST here too. Re-exporting `handlers`
 * from ../../../auth wires that up in two lines.
 *
 * Auth.js does its own async cookies() reads internally, so we don't need to
 * do anything Next 16-specific here — this route is a pure passthrough.
 */
import { handlers } from '@/auth'
export const { GET, POST } = handlers
