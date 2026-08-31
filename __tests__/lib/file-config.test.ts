/**
 * @jest-environment node
 */

import {
  ACCEPTED_FILE_TYPES,
  MAX_FILE_SIZE_BYTES,
  MAX_FILE_SIZE_LABEL,
  buildAcceptAttr,
  formatBytes,
  isAcceptedType,
  acceptedExtensionsLabel,
  validateMagicBytes,
} from '@/lib/file-config'

describe('buildAcceptAttr', () => {
  it('returns a comma-separated list of all accepted MIME types', () => {
    const result = buildAcceptAttr()
    const expected = ACCEPTED_FILE_TYPES.map((t) => t.mimeType).join(',')
    expect(result).toBe(expected)
  })

  it('includes PDF and common image MIME types', () => {
    const result = buildAcceptAttr()
    expect(result).toContain('application/pdf')
    expect(result).toContain('image/jpeg')
    expect(result).toContain('image/png')
  })
})

describe('isAcceptedType', () => {
  const makeFile = (type: string) => new File(['content'], 'test-file', { type })

  it('accepts PDF', () => {
    expect(isAcceptedType(makeFile('application/pdf'))).toBe(true)
  })

  it('accepts JPEG', () => {
    expect(isAcceptedType(makeFile('image/jpeg'))).toBe(true)
  })

  it('accepts PNG', () => {
    expect(isAcceptedType(makeFile('image/png'))).toBe(true)
  })

  it('rejects HEIC', () => {
    expect(isAcceptedType(makeFile('image/heic'))).toBe(false)
  })

  it('accepts WebP', () => {
    expect(isAcceptedType(makeFile('image/webp'))).toBe(true)
  })

  it('rejects plain text', () => {
    expect(isAcceptedType(makeFile('text/plain'))).toBe(false)
  })

  it('rejects Word documents', () => {
    expect(isAcceptedType(makeFile('application/msword'))).toBe(false)
  })

  it('rejects empty MIME type', () => {
    expect(isAcceptedType(makeFile(''))).toBe(false)
  })
})

describe('acceptedExtensionsLabel', () => {
  it('returns a non-empty string', () => {
    expect(acceptedExtensionsLabel().length).toBeGreaterThan(0)
  })

  it('contains "and" before the last extension', () => {
    expect(acceptedExtensionsLabel()).toMatch(/and [A-Z]+$/)
  })

  it('lists extensions in uppercase', () => {
    const label = acceptedExtensionsLabel()
    const words = label
      .replace(/,| and /g, ' ')
      .trim()
      .split(/\s+/)
    words.forEach((w) => expect(w).toBe(w.toUpperCase()))
  })
})

describe('MAX_FILE_SIZE_BYTES', () => {
  // Vercel rejects any request body over 4.5 MB with a 413 BEFORE the route runs,
  // so an app limit above that is unenforceable: files in the gap die at the edge
  // with an opaque error the route never gets to explain. Raising the real ceiling
  // requires uploading to blob storage first, not just a bigger number here.
  const VERCEL_LIMIT_BINARY = 4.5 * 1024 * 1024 // 4,718,592
  // Multipart framing (boundaries + part headers) adds ~300 bytes to the body, so
  // the limit must leave at least that much room under the platform cap.
  const MULTIPART_OVERHEAD = 1024

  it('leaves room for multipart framing under the platform cap', () => {
    expect(MAX_FILE_SIZE_BYTES + MULTIPART_OVERHEAD).toBeLessThanOrEqual(VERCEL_LIMIT_BINARY)
  })

  it('is 4,700,000 bytes', () => {
    expect(MAX_FILE_SIZE_BYTES).toBe(4_700_000)
  })
})

describe('MAX_FILE_SIZE_LABEL', () => {
  it('never advertises more than the limit actually allows', () => {
    // Floored, not rounded. Promising "4.5 MB" and then rejecting a 4.5 MB file is
    // the kind of small lie that wastes an afternoon.
    const advertised = parseFloat(MAX_FILE_SIZE_LABEL) * 1024 * 1024
    expect(advertised).toBeLessThanOrEqual(MAX_FILE_SIZE_BYTES)
  })

  it('reads as a size, ready to drop into copy', () => {
    expect(MAX_FILE_SIZE_LABEL).toBe('4.4 MB')
  })
})

describe('formatBytes', () => {
  it('renders a human-readable MB string', () => {
    expect(formatBytes(4 * 1024 * 1024)).toBe('4.0 MB')
    expect(formatBytes(352 * 1024)).toBe('0.3 MB')
  })
})

describe('validateMagicBytes', () => {
  function makeFileWithBytes(bytes: number[], mimeType: string): File {
    const content = new Uint8Array(Math.max(bytes.length, 12))
    bytes.forEach((b, i) => {
      content[i] = b
    })
    return new File([content], 'test', { type: mimeType })
  }

  it('returns true for a valid PDF (first 4 bytes = %PDF)', async () => {
    const file = makeFileWithBytes([0x25, 0x50, 0x44, 0x46], 'application/pdf')
    expect(await validateMagicBytes(file)).toBe(true)
  })

  it('returns true for a valid JPEG (first 3 bytes = FF D8 FF)', async () => {
    const file = makeFileWithBytes([0xff, 0xd8, 0xff, 0xe0], 'image/jpeg')
    expect(await validateMagicBytes(file)).toBe(true)
  })

  it('returns true for a valid PNG', async () => {
    const file = makeFileWithBytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 'image/png')
    expect(await validateMagicBytes(file)).toBe(true)
  })

  it('returns true for a valid WebP', async () => {
    // RIFF at 0-3, arbitrary 4 bytes for size, WEBP at 8-11
    const file = makeFileWithBytes(
      [0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50],
      'image/webp',
    )
    expect(await validateMagicBytes(file)).toBe(true)
  })

  it('returns false for a file with wrong magic bytes despite correct MIME type', async () => {
    // Declares itself as PDF but bytes are all zeros
    const file = makeFileWithBytes([0x00, 0x00, 0x00, 0x00], 'application/pdf')
    expect(await validateMagicBytes(file)).toBe(false)
  })

  it('returns false for an empty file (0 bytes)', async () => {
    const file = new File([], 'empty.pdf', { type: 'application/pdf' })
    expect(await validateMagicBytes(file)).toBe(false)
  })

  it('returns false for a file shorter than 12 bytes with no valid magic header', async () => {
    // 3 bytes — not enough to match any magic signature
    const file = new File([new Uint8Array([0x25, 0x50, 0x44])], 'short.pdf', {
      type: 'application/pdf',
    })
    expect(await validateMagicBytes(file)).toBe(false)
  })

  it('returns true for a valid PDF even when the file is exactly 4 bytes', async () => {
    // Minimum possible valid PDF magic: exactly the 4 magic bytes, nothing else
    const file = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], 'min.pdf', {
      type: 'application/pdf',
    })
    expect(await validateMagicBytes(file)).toBe(true)
  })
})
