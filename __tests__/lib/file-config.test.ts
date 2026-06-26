/**
 * @jest-environment node
 */

import {
  ACCEPTED_FILE_TYPES,
  MAX_FILE_SIZE_BYTES,
  buildAcceptAttr,
  isAcceptedType,
  acceptedExtensionsLabel,
  validateMagicBytes,
} from '@/lib/file-config'

describe('buildAcceptAttr', () => {
  it('returns a comma-separated list of all accepted MIME types', () => {
    const result = buildAcceptAttr()
    const expected = ACCEPTED_FILE_TYPES.map(t => t.mimeType).join(',')
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
  const makeFile = (type: string) =>
    new File(['content'], 'test-file', { type })

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
    const words = label.replace(/,| and /g, ' ').trim().split(/\s+/)
    words.forEach(w => expect(w).toBe(w.toUpperCase()))
  })
})

describe('MAX_FILE_SIZE_BYTES', () => {
  it('is 20 MB', () => {
    expect(MAX_FILE_SIZE_BYTES).toBe(20 * 1024 * 1024)
  })
})

describe('validateMagicBytes', () => {
  function makeFileWithBytes(bytes: number[], mimeType: string): File {
    const content = new Uint8Array(Math.max(bytes.length, 12))
    bytes.forEach((b, i) => { content[i] = b })
    return new File([content], 'test', { type: mimeType })
  }

  it('returns true for a valid PDF (first 4 bytes = %PDF)', async () => {
    const file = makeFileWithBytes([0x25, 0x50, 0x44, 0x46], 'application/pdf')
    expect(await validateMagicBytes(file)).toBe(true)
  })

  it('returns true for a valid JPEG (first 3 bytes = FF D8 FF)', async () => {
    const file = makeFileWithBytes([0xFF, 0xD8, 0xFF, 0xE0], 'image/jpeg')
    expect(await validateMagicBytes(file)).toBe(true)
  })

  it('returns true for a valid PNG', async () => {
    const file = makeFileWithBytes(
      [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A],
      'image/png',
    )
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
    const file = new File([new Uint8Array([0x25, 0x50, 0x44])], 'short.pdf', { type: 'application/pdf' })
    expect(await validateMagicBytes(file)).toBe(false)
  })

  it('returns true for a valid PDF even when the file is exactly 4 bytes', async () => {
    // Minimum possible valid PDF magic: exactly the 4 magic bytes, nothing else
    const file = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], 'min.pdf', { type: 'application/pdf' })
    expect(await validateMagicBytes(file)).toBe(true)
  })
})
