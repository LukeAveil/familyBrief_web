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
