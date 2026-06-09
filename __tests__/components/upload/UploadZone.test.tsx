import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import UploadZone from '@/components/upload/UploadZone'

const onUploadSuccess = jest.fn()
const onUploadError = jest.fn()

const mockFetch = (ok: boolean, filename = 'letter.pdf') => {
  global.fetch = jest.fn().mockResolvedValue({
    json: () => Promise.resolve(ok ? { ok: true, filename } : { ok: false, error: 'Bad type' }),
  } as Response)
}

beforeEach(() => {
  jest.clearAllMocks()
})

const setup = () => {
  const user = userEvent.setup()
  render(<UploadZone onUploadSuccess={onUploadSuccess} onUploadError={onUploadError} />)
  return { user }
}

describe('UploadZone', () => {
  it('renders the drop zone and buttons', () => {
    mockFetch(true)
    setup()
    expect(screen.getByRole('button', { name: /choose file/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /take photo/i })).toBeInTheDocument()
    expect(screen.getByText(/drop your letter here/i)).toBeInTheDocument()
  })

  it('displays accepted file types', () => {
    mockFetch(true)
    setup()
    expect(screen.getByText(/accepts/i)).toBeInTheDocument()
  })

  it('calls onUploadSuccess with the filename after a successful upload', async () => {
    mockFetch(true, 'school-letter.pdf')
    const { user } = setup()

    const file = new File(['content'], 'school-letter.pdf', { type: 'application/pdf' })
    const input = document.querySelector<HTMLInputElement>('input[type="file"]:not([capture])')!
    await user.upload(input, file)

    await waitFor(() => expect(onUploadSuccess).toHaveBeenCalledWith('school-letter.pdf'))
    expect(onUploadError).not.toHaveBeenCalled()
  })

  it('calls onUploadError with the filename when the API returns ok:false', async () => {
    mockFetch(false)
    const { user } = setup()

    // Use a valid MIME type so userEvent (which respects `accept`) allows the upload.
    // The API mock returns ok:false to simulate server-side rejection.
    const file = new File(['content'], 'letter.pdf', { type: 'application/pdf' })
    const input = document.querySelector<HTMLInputElement>('input[type="file"]:not([capture])')!
    await user.upload(input, file)

    await waitFor(() => expect(onUploadError).toHaveBeenCalledWith('letter.pdf'))
    expect(onUploadSuccess).not.toHaveBeenCalled()
  })

  it('calls onUploadError when fetch throws a network error', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('Network failure'))
    const { user } = setup()

    const file = new File(['content'], 'letter.pdf', { type: 'application/pdf' })
    const input = document.querySelector<HTMLInputElement>('input[type="file"]:not([capture])')!
    await user.upload(input, file)

    await waitFor(() => expect(onUploadError).toHaveBeenCalledWith('letter.pdf'))
  })

  it('disables buttons and shows uploading state while the request is in flight', async () => {
    let resolve: (v: unknown) => void
    global.fetch = jest.fn().mockReturnValue(
      new Promise(r => { resolve = r })
    )
    const { user } = setup()

    const file = new File(['content'], 'letter.pdf', { type: 'application/pdf' })
    const input = document.querySelector<HTMLInputElement>('input[type="file"]:not([capture])')!
    await user.upload(input, file)

    // Both the heading span and the Choose-file button show "Uploading…"
    expect(screen.getAllByText(/uploading…/i).length).toBeGreaterThanOrEqual(1)
    expect(screen.getByRole('button', { name: /uploading…/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /take photo/i })).toBeDisabled()

    // Resolve the request so the component cleans up
    resolve!({ json: () => Promise.resolve({ ok: true, filename: 'letter.pdf' }) })
    await waitFor(() => expect(screen.getByText(/drop your letter here/i)).toBeInTheDocument())
  })

  it('POSTs a FormData object with a "file" field to /api/upload', async () => {
    mockFetch(true, 'letter.pdf')
    const { user } = setup()

    const file = new File(['content'], 'letter.pdf', { type: 'application/pdf' })
    const input = document.querySelector<HTMLInputElement>('input[type="file"]:not([capture])')!
    await user.upload(input, file)

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1))

    const [url, init] = (global.fetch as jest.Mock).mock.calls[0]
    expect(url).toBe('/api/upload')
    expect(init.method).toBe('POST')
    expect(init.body).toBeInstanceOf(FormData)
    expect((init.body as FormData).get('file')).toEqual(file)
  })
})
