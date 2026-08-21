import { redirect } from 'next/navigation'
import { auth } from '@/auth'
import ScreenRouter from '@/components/ScreenRouter'

// Server-side auth check. The proxy already redirects requests with no session
// cookie (see proxy.ts), so most anonymous visitors never reach this code.
// This is the *authoritative* check: the proxy only knows a cookie exists,
// while auth() actually resolves it against the sessions table — so a stale,
// tampered, or expired cookie is caught here and sent to /signin. Belt-and-braces
// per the Next 16 docs: "Always verify authentication and authorization inside
// each Server Function rather than relying on Proxy alone."
export default async function Home() {
  const session = await auth()
  if (!session?.user) redirect('/signin')
  return <ScreenRouter />
}
