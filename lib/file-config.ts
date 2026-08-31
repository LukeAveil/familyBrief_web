export interface FileType {
  mimeType: string
  extensions: string[]
}

export const ACCEPTED_FILE_TYPES: FileType[] = [
  { mimeType: 'application/pdf', extensions: ['pdf'] },
  { mimeType: 'image/jpeg', extensions: ['jpg', 'jpeg'] },
  { mimeType: 'image/png', extensions: ['png'] },
  { mimeType: 'image/webp', extensions: ['webp'] },
]

/**
 * The ceiling is set by the PLATFORM, not by us.
 *
 * Vercel rejects any request body over 4.5 MB with a 413 before the route handler
 * ever runs. So the app's own limit has to sit under that — otherwise a file in
 * the gap dies at the edge and the route's careful "File too large" message never
 * gets a chance to run. (This was 20 MB once, advertising a ceiling four times
 * higher than anything that could actually be uploaded.)
 *
 * WHY THIS NUMBER, AND NOT A ROUND ONE: Vercel documents "4.5 MB" without saying
 * which MB. Both readings are live possibilities:
 *
 *   4.5 MiB = 4,718,592 bytes   (binary — the generous reading)
 *   4.5 MB  = 4,500,000 bytes   (decimal — the strict reading)
 *
 * We sit just under the BINARY figure, leaving ~18 KB for multipart framing
 * (boundaries and part headers add roughly 300 bytes to the body, so the margin
 * is ~60x what's needed). That admits the largest files the platform can possibly
 * accept. If the decimal reading turns out to be the real one, files between
 * 4,500,000 and this limit will 413 at the edge — the client handles that with
 * an honest message (see resolveError in ScreenRouter), rather than a mystery.
 *
 * Genuinely raising the ceiling means the file must not travel through the
 * function at all: upload it straight to blob storage and pass the route a
 * reference. That's the only way past 4.5 MB, and it's a much bigger change than
 * this number.
 */
export const MAX_FILE_SIZE_BYTES = 4_700_000

/**
 * The same limit as copy, floored to one decimal place.
 *
 * Floored, not rounded: `toFixed(1)` on 4.48 gives "4.5", which would promise a
 * ceiling we actually reject. Telling a parent the limit is 4.5 MB and then
 * refusing a 4.5 MB file is the kind of small lie that wastes an afternoon.
 */
export const MAX_FILE_SIZE_LABEL = `${(Math.floor((MAX_FILE_SIZE_BYTES / (1024 * 1024)) * 10) / 10).toFixed(1)} MB`

/** Human-readable size for error copy, e.g. `formatBytes(352000)` → "0.3 MB". */
export function formatBytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function buildAcceptAttr(): string {
  return ACCEPTED_FILE_TYPES.map((t) => t.mimeType).join(',')
}

export function isAcceptedType(file: File): boolean {
  return ACCEPTED_FILE_TYPES.some((t) => t.mimeType === file.type)
}

export function acceptedExtensionsLabel(): string {
  const exts = ACCEPTED_FILE_TYPES.flatMap((t) => t.extensions).map((e) => e.toUpperCase())
  return [...exts.slice(0, -1), `and ${exts.at(-1)}`].join(', ')
}

export async function validateMagicBytes(file: File): Promise<boolean> {
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer())

  // PDF: %PDF
  if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) return true

  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return true

  // PNG: 89 50 4E 47
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return true

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
  )
    return true

  return false
}
