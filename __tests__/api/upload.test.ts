/**
 * @jest-environment node
 */
import { NextRequest } from 'next/server'
import { POST } from '@/app/api/upload/route'
import { MAX_FILE_SIZE_BYTES } from '@/lib/file-config'

const makeRequest = (formData: FormData) =>
  new NextRequest('http://localhost/api/upload', { method: 'POST', body: formData })

const makeFormData = (file: File, fieldName = 'file') => {
  const fd = new FormData()
  fd.append(fieldName, file)
  return fd
}

const makeFile = (name: string, type: string, sizeBytes = 100) =>
  new File([new Uint8Array(sizeBytes)], name, { type })

describe('POST /api/upload', () => {
  it('returns 400 when no file is present', async () => {
    const res = await POST(makeRequest(new FormData()))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.ok).toBe(false)
  })

  it('returns 400 when the field name is wrong', async () => {
    const fd = makeFormData(makeFile('doc.pdf', 'application/pdf'), 'document')
    const res = await POST(makeRequest(fd))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.ok).toBe(false)
  })

  it('returns 415 for an unsupported file type', async () => {
    const fd = makeFormData(makeFile('notes.txt', 'text/plain'))
    const res = await POST(makeRequest(fd))
    expect(res.status).toBe(415)
    const body = await res.json()
    expect(body.ok).toBe(false)
    expect(body.error).toBeTruthy()
  })

  it('returns 413 when the file exceeds the size limit', async () => {
    const fd = makeFormData(makeFile('big.pdf', 'application/pdf', MAX_FILE_SIZE_BYTES + 1))
    const res = await POST(makeRequest(fd))
    expect(res.status).toBe(413)
    const body = await res.json()
    expect(body.ok).toBe(false)
  })

  it('returns 200 with ok and filename for a valid PDF', async () => {
    const fd = makeFormData(makeFile('letter.pdf', 'application/pdf'))
    const res = await POST(makeRequest(fd))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.filename).toBe('letter.pdf')
  })

  it('returns 200 for a valid JPEG', async () => {
    const fd = makeFormData(makeFile('photo.jpg', 'image/jpeg'))
    const res = await POST(makeRequest(fd))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.filename).toBe('photo.jpg')
  })

  it('returns 200 for a valid PNG', async () => {
    const fd = makeFormData(makeFile('scan.png', 'image/png'))
    const res = await POST(makeRequest(fd))
    expect(res.status).toBe(200)
    expect((await res.json()).ok).toBe(true)
  })

  it('accepts a file exactly at the size limit', async () => {
    const fd = makeFormData(makeFile('max.pdf', 'application/pdf', MAX_FILE_SIZE_BYTES))
    const res = await POST(makeRequest(fd))
    expect(res.status).toBe(200)
  })
})
