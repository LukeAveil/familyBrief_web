/**
 * /signin — server component that shells the sign-in form.
 * ────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS A SERVER COMPONENT
 *   The page needs to read ?callbackUrl from the URL server-side (so we can
 *   validate/normalize it in future stages) and hand it to the client form as
 *   a prop. A server component reads searchParams natively.
 *
 * NEXT 16: searchParams IS A PROMISE
 *   Previously (v14) it was a plain object; v15 introduced async and v16
 *   removes the sync compatibility. Must await. See
 *   node_modules/next/dist/docs/01-app/02-guides/upgrading/version-16.md L294.
 *
 * WHY WE DEFAULT callbackUrl TO "/"
 *   The proxy always sets it (from the requested path), but a direct visit to
 *   /signin has none. Sending them to the workspace root after sign-in is the
 *   safe default.
 */

import SignInForm from './SignInForm'

interface SignInPageProps {
  searchParams: Promise<{ callbackUrl?: string }>
}

export default async function SignInPage({ searchParams }: SignInPageProps) {
  const { callbackUrl = '/' } = await searchParams

  return (
    <main className="flex-1 flex items-center justify-center px-4 py-16">
      <SignInForm callbackUrl={callbackUrl} />
    </main>
  )
}
