/**
 * @jest-environment node
 *
 * Focused auth-gate tests for POST /api/chat. This route's full behavior is
 * exercised end-to-end via ChatPanel.test.tsx; here we just lock in that the
 * new auth check runs before any body parsing or SDK work.
 */

// Anthropic SDK mocked so the route file's imports are inert. We don't need
// to configure returns because the auth-gate tests never reach the SDK call.
jest.mock('@anthropic-ai/sdk', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    messages: { stream: jest.fn() },
  })),
}))

// Mocked via relative path — jest.mock's hoisted resolver doesn't apply the
// `@/*` moduleNameMapper for project-root files, but relative paths always
// work. Consistent with how @/app/signin/actions is mocked in SignInForm.test.
const mockAuth = jest.fn()
jest.mock('../../auth', () => ({
  __esModule: true,
  auth: (...args: unknown[]) => mockAuth(...args),
}))

import { NextRequest } from 'next/server'
import { POST } from '@/app/api/chat/route'

beforeEach(() => mockAuth.mockReset())

function makeRequest(body: unknown = {}) {
  return new NextRequest('http://localhost/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/chat — auth gate', () => {
  it('returns 401 when no session is present', async () => {
    mockAuth.mockResolvedValueOnce(null)
    const res = await POST(makeRequest())
    expect(res.status).toBe(401)
    expect(await res.text()).toBe('Unauthorized')
  })

  it('returns 401 when the session has no user', async () => {
    mockAuth.mockResolvedValueOnce({} as { user?: never })
    const res = await POST(makeRequest())
    expect(res.status).toBe(401)
  })

  it('does not attempt to parse the request body when unauthenticated', async () => {
    mockAuth.mockResolvedValueOnce(null)
    // Malformed JSON would 400 for a signed-in caller (see body-parsing branch
    // in the route). With no session we should short-circuit before that,
    // proving the auth check runs first.
    const req = new NextRequest('http://localhost/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not-json',
    })
    const res = await POST(req)
    expect(res.status).toBe(401)
  })

  it('passes the auth gate and moves on to body validation when signed in', async () => {
    mockAuth.mockResolvedValueOnce({ user: { id: '1', email: 'test@example.com' } })
    // Empty JSON body → the route's own validation should reject with 400
    // (missing letter). Proves we got past auth and into normal request handling.
    const res = await POST(makeRequest({}))
    expect(res.status).toBe(400)
  })
})
