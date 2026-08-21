/**
 * Server action for the sign-in form.
 * ────────────────────────────────────────────────────────────────────────────
 * WHY A SERVER ACTION (not a POST route)
 *   The form only needs to fire signIn() and return one of two shapes to the
 *   client (ok / error). A server action gives us type-safe args and a single
 *   file to reason about; a REST endpoint would need its own request/response
 *   shaping for the same behaviour.
 *
 * WHY redirect: false
 *   By default Auth.js `signIn()` throws NEXT_REDIRECT to route the browser
 *   to the verifyRequest page. We render the "check your inbox" state inline
 *   in the same /signin route, so we suppress the redirect and let the client
 *   component swap its own UI on success.
 *
 * WHY WE SANITIZE THE ERROR MESSAGE
 *   Auth.js AuthError messages can leak provider internals ("Resend error:
 *   {\"statusCode\":400,\"message\":\"...\"}"). The user only needs to know
 *   the address didn't work — matches the sanitization pattern used in
 *   app/api/upload/route.ts and app/api/chat/route.ts.
 */
'use server'

import { AuthError } from 'next-auth'
import { signIn } from '@/auth'

export type SendMagicLinkResult = { ok: true } | { ok: false; error: string }

export async function sendMagicLink(
  email: string,
  callbackUrl: string,
): Promise<SendMagicLinkResult> {
  try {
    await signIn('resend', { email, redirectTo: callbackUrl, redirect: false })
    return { ok: true }
  } catch (err) {
    // AuthError = Auth.js knew what went wrong (bad email format, Resend
    // rejected the send, etc.). Anything else — network, DB down, provider
    // outage — is a genuine bug; re-throw so Next's error boundary catches it.
    if (err instanceof AuthError) {
      console.error('[signin] AuthError sending magic link:', err.type, err.message)
      return { ok: false, error: 'Could not send sign-in email. Check the address and try again.' }
    }
    throw err
  }
}
