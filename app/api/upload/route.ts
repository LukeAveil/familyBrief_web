import { NextRequest, NextResponse } from 'next/server'
import { isAcceptedType, MAX_FILE_SIZE_BYTES, validateMagicBytes } from '@/lib/file-config'
import { extractEventsFromFile } from '@/lib/extract-events'

// ─── Rate limiting ────────────────────────────────────────────────────────────

const RATE_LIMIT_MAX = 5
const RATE_LIMIT_WINDOW_MS = 60 * 1000 // 60 seconds

const rateLimitMap = new Map<string, number[]>()

// Exposed for tests so per-suite isolation doesn't require module re-loading.
export function clearRateLimitState() { rateLimitMap.clear() }

function isRateLimited(ip: string): boolean {
  const now = Date.now()
  const timestamps = (rateLimitMap.get(ip) ?? []).filter(t => now - t < RATE_LIMIT_WINDOW_MS)
  // Always write back the pruned list so stale entries don't accumulate in the map.
  rateLimitMap.set(ip, timestamps)
  if (timestamps.length >= RATE_LIMIT_MAX) return true
  timestamps.push(now)
  return false
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  // Use the rightmost x-forwarded-for entry — Vercel appends the connecting IP
  // there, so it cannot be spoofed by a client prepending fake IPs.
  const forwarded = req.headers.get('x-forwarded-for')
  const ip =
    (forwarded ? forwarded.split(',').at(-1)?.trim() : null) ??
    req.headers.get('x-real-ip') ??
    'unknown'

  if (isRateLimited(ip)) {
    return NextResponse.json(
      { ok: false, error: 'Too many requests. Please wait a moment.' },
      { status: 429 },
    )
  }

  const formData = await req.formData()
  const file = formData.get('file')

  if (!(file instanceof File)) {
    return NextResponse.json({ ok: false, error: 'No file received' }, { status: 400 })
  }
  if (!isAcceptedType(file)) {
    return NextResponse.json({ ok: false, error: 'Unsupported file type' }, { status: 415 })
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return NextResponse.json({ ok: false, error: 'File too large (max 20 MB)' }, { status: 413 })
  }
  if (!(await validateMagicBytes(file))) {
    return NextResponse.json(
      { ok: false, error: 'File content does not match its type' },
      { status: 415 },
    )
  }

  try {
    const bytes = await file.arrayBuffer()
    const base64 = Buffer.from(bytes).toString('base64')
    const events = await extractEventsFromFile(base64, file.type)
    return NextResponse.json({ ok: true, filename: file.name, events })
  } catch (err) {
    console.error('[upload] extraction failed:', err)
    return NextResponse.json({ ok: false, error: 'Extraction failed. Please try again.' }, { status: 500 })
  }
}
