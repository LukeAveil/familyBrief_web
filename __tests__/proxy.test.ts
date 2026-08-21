/**
 * @jest-environment node
 */

import { NextRequest } from 'next/server'
import { proxy, config } from '@/proxy'

// Build a NextRequest and, if given, seed a session cookie on it. NextRequest
// exposes .cookies with a get() API; setting them via headers is the simplest
// portable way — the Cookie header is what the constructor parses.
function makeRequest(pathname: string, opts: { cookie?: string } = {}): NextRequest {
  const url = new URL(pathname, 'http://localhost')
  const headers: Record<string, string> = {}
  if (opts.cookie) headers.cookie = opts.cookie
  return new NextRequest(url, { headers })
}

describe('proxy', () => {
  describe('config.matcher', () => {
    it('matches the workspace root and nothing else in Stage 1', () => {
      // Explicit assertion so that if someone adds a route without touching
      // this list, the test flags it. Stage 1 has exactly one gated route.
      expect(config.matcher).toEqual(['/'])
    })
  })

  describe('proxy()', () => {
    it('redirects to /signin?callbackUrl=/ when no session cookie is present', () => {
      const res = proxy(makeRequest('/'))
      // 307 (temporary redirect) is what NextResponse.redirect() emits by default.
      expect(res.status).toBe(307)
      const location = res.headers.get('location')!
      const url = new URL(location)
      expect(url.pathname).toBe('/signin')
      expect(url.searchParams.get('callbackUrl')).toBe('/')
    })

    it('preserves search params in the callbackUrl', () => {
      const res = proxy(makeRequest('/?preview=results'))
      const url = new URL(res.headers.get('location')!)
      expect(url.searchParams.get('callbackUrl')).toBe('/?preview=results')
    })

    it('passes through when the dev session cookie (authjs.session-token) is present', () => {
      const res = proxy(makeRequest('/', { cookie: 'authjs.session-token=abc123' }))
      // NextResponse.next() returns a 200 pass-through (no Location header).
      expect(res.status).toBe(200)
      expect(res.headers.get('location')).toBeNull()
    })

    it('passes through when the prod session cookie (__Secure-authjs.session-token) is present', () => {
      const res = proxy(makeRequest('/', { cookie: '__Secure-authjs.session-token=abc123' }))
      expect(res.status).toBe(200)
      expect(res.headers.get('location')).toBeNull()
    })

    it('treats unrelated cookies as absence of a session', () => {
      const res = proxy(makeRequest('/', { cookie: 'theme=dark; consent=1' }))
      expect(res.status).toBe(307)
      expect(res.headers.get('location')).toContain('/signin')
    })
  })
})
