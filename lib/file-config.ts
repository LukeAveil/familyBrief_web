export interface FileType {
  mimeType: string
  extensions: string[]
}

export const ACCEPTED_FILE_TYPES: FileType[] = [
  { mimeType: 'application/pdf', extensions: ['pdf'] },
  { mimeType: 'image/jpeg',      extensions: ['jpg', 'jpeg'] },
  { mimeType: 'image/png',       extensions: ['png'] },
  { mimeType: 'image/webp',      extensions: ['webp'] },
]

export const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024 // 20 MB

export function buildAcceptAttr(): string {
  return ACCEPTED_FILE_TYPES.map(t => t.mimeType).join(',')
}

export function isAcceptedType(file: File): boolean {
  return ACCEPTED_FILE_TYPES.some(t => t.mimeType === file.type)
}

export function acceptedExtensionsLabel(): string {
  const exts = ACCEPTED_FILE_TYPES.flatMap(t => t.extensions).map(e => e.toUpperCase())
  return [...exts.slice(0, -1), `and ${exts.at(-1)}`].join(', ')
}

export async function validateMagicBytes(file: File): Promise<boolean> {
  const fullBuf = await file.arrayBuffer()
  const bytes = new Uint8Array(fullBuf.slice(0, 12))

  // PDF: %PDF
  if (
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46
  ) return true

  // JPEG: FF D8 FF
  if (
    bytes[0] === 0xFF &&
    bytes[1] === 0xD8 &&
    bytes[2] === 0xFF
  ) return true

  // PNG: 89 50 4E 47
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4E &&
    bytes[3] === 0x47
  ) return true

  // WebP: RIFF at 0-3 and WEBP at 8-11
  if (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) return true

  return false
}
