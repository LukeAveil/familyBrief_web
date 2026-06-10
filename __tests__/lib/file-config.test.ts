import {
  ACCEPTED_FILE_TYPES,
  MAX_FILE_SIZE_BYTES,
  buildAcceptAttr,
  isAcceptedType,
  acceptedExtensionsLabel,
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
