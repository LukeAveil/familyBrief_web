import { NextRequest, NextResponse } from 'next/server'
import { isAcceptedType, MAX_FILE_SIZE_BYTES } from '@/lib/file-config'

export async function POST(req: NextRequest) {
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

  // AI extraction will be wired here
  return NextResponse.json({ ok: true, filename: file.name })
}
