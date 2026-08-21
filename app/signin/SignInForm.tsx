'use client'

/**
 * SignInForm — client-side state machine for the magic-link sign-in flow.
 * ────────────────────────────────────────────────────────────────────────────
 * States:
 *   idle    → email input + "Send magic link" button
 *   loading → button disabled, "Sending…"
 *   sent    → replace form with "Check your inbox at <email>" + reset link
 *   error   → inline message below the input; form remains usable
 *
 * WHY A CLIENT COMPONENT (not a plain <form action={serverAction}>)
 *   The plain form pattern works for one-shot posts but can't render local
 *   states (loading, sent) without either a full page navigation or extra
 *   `useFormState`/`useFormStatus` plumbing. A tiny client component with
 *   useState is more direct for a 4-state UI. The heavy lifting still runs
 *   in the server action.
 *
 * WHY WE KEEP THE EMAIL IN LOCAL STATE
 *   The "sent" state greets the user by address ("Check your inbox at
 *   jane@example.com") — a small trust cue. That's the only reason we hold it
 *   client-side; the value that mattered for sending was already sent to the
 *   server action.
 *
 * WHY NO CLIENT-SIDE EMAIL VALIDATION BEYOND type="email" required
 *   The browser already blocks empty/malformed submits at the HTML level.
 *   Auth.js and Resend do the authoritative validation server-side. Doubling
 *   it here would just create a source of drift.
 */

import { useState } from 'react'
import { sendMagicLink } from './actions'

interface SignInFormProps {
  callbackUrl: string
}

type FormState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'sent'; email: string }
  | { kind: 'error'; message: string }

export default function SignInForm({ callbackUrl }: SignInFormProps) {
  const [state, setState] = useState<FormState>({ kind: 'idle' })
  const [email, setEmail] = useState('')

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setState({ kind: 'loading' })
    const result = await sendMagicLink(email, callbackUrl)
    if (result.ok) {
      setState({ kind: 'sent', email })
    } else {
      setState({ kind: 'error', message: result.error })
    }
  }

  if (state.kind === 'sent') {
    return (
      <div className="w-full max-w-sm text-center">
        <h1 className="text-2xl font-semibold text-ink mb-2">Check your inbox</h1>
        <p className="text-primary mb-6">
          We&apos;ve sent a sign-in link to <strong>{state.email}</strong>. It expires in 24 hours.
        </p>
        <button
          type="button"
          className="text-sm text-primary underline hover:text-ink"
          onClick={() => {
            setEmail('')
            setState({ kind: 'idle' })
          }}
        >
          Use a different email
        </button>
      </div>
    )
  }

  const busy = state.kind === 'loading'

  return (
    <form onSubmit={onSubmit} className="w-full max-w-sm">
      <h1 className="text-2xl font-semibold text-ink mb-2">Sign in to FamilyBrief</h1>
      <p className="text-primary mb-6">Enter your email and we&apos;ll send you a sign-in link.</p>

      <label htmlFor="email" className="block text-sm font-medium text-ink mb-1">
        Email
      </label>
      <input
        id="email"
        name="email"
        type="email"
        required
        autoFocus
        autoComplete="email"
        disabled={busy}
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="w-full border border-line rounded-md px-3 py-2 text-ink focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-60"
      />

      {state.kind === 'error' && (
        <p role="alert" className="mt-2 text-sm text-red-600">
          {state.message}
        </p>
      )}

      <button
        type="submit"
        disabled={busy}
        className="mt-4 w-full bg-ink text-white rounded-md py-2 font-medium disabled:opacity-60"
      >
        {busy ? 'Sending…' : 'Send magic link'}
      </button>
    </form>
  )
}
