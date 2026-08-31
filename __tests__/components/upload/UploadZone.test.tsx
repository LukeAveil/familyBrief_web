import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import UploadZone from '@/components/upload/UploadZone'
import { MAX_FILE_SIZE_BYTES } from '@/lib/file-config'

const onFileReady = jest.fn()

beforeEach(() => {
  jest.clearAllMocks()
  // Default: non-touch device (matchMedia global mock returns matches: false)
})

const setup = () => {
  const user = userEvent.setup()
  render(<UploadZone onFileReady={onFileReady} />)
  return { user }
}

const setupTouchDevice = () => {
  ;(window.matchMedia as jest.Mock).mockImplementation((query: string) => ({
    matches: query === '(hover: none) and (pointer: coarse)',
    media: query,
    onchange: null,
    addListener: jest.fn(),
    removeListener: jest.fn(),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    dispatchEvent: jest.fn(),
  }))
  const user = userEvent.setup()
  render(<UploadZone onFileReady={onFileReady} />)
  return { user }
}

describe('UploadZone', () => {
  it('renders the drop zone and choose-file button on desktop', () => {
    setup()
    expect(screen.getByRole('button', { name: /choose file/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /take photo/i })).not.toBeInTheDocument()
    expect(screen.getByText(/drop your letter here/i)).toBeInTheDocument()
  })

  it('shows the Take photo button on touch devices', async () => {
    setupTouchDevice()
    // useEffect runs after mount — wait for state update
    await act(async () => {})
    expect(screen.getByRole('button', { name: /take photo/i })).toBeInTheDocument()
  })

  it('displays accepted file types', () => {
    setup()
    expect(screen.getByText(/accepts/i)).toBeInTheDocument()
  })

  it('calls onFileReady with the File object when a valid file is selected', async () => {
    const { user } = setup()
    const file = new File(['content'], 'letter.pdf', { type: 'application/pdf' })
    const input = document.querySelector<HTMLInputElement>('input[type="file"]:not([capture])')!
    await user.upload(input, file)
    expect(onFileReady).toHaveBeenCalledTimes(1)
    expect(onFileReady).toHaveBeenCalledWith(file)
  })

  it('calls onFileReady for a valid JPEG', async () => {
    const { user } = setup()
    const file = new File(['content'], 'photo.jpg', { type: 'image/jpeg' })
    const input = document.querySelector<HTMLInputElement>('input[type="file"]:not([capture])')!
    await user.upload(input, file)
    expect(onFileReady).toHaveBeenCalledWith(file)
  })

  it('does not call onFileReady for a disallowed MIME type dragged in', async () => {
    setup()
    // text/plain is not in ACCEPTED_FILE_TYPES so handleFile returns early
    const file = new File(['content'], 'notes.txt', { type: 'text/plain' })
    const zone = screen.getByRole('button', { name: /upload a school letter/i })

    const dropEvent = new Event('drop', { bubbles: true }) as unknown as React.DragEvent
    Object.defineProperty(dropEvent, 'dataTransfer', {
      value: { files: [file] },
    })
    act(() => {
      zone.dispatchEvent(dropEvent as unknown as Event)
    })

    expect(onFileReady).not.toHaveBeenCalled()
  })

  it('does not call onFileReady when no file is given', async () => {
    const { user } = setup()
    const input = document.querySelector<HTMLInputElement>('input[type="file"]:not([capture])')!
    // Upload with no files — userEvent skips if array is empty
    await user.upload(input, [])
    expect(onFileReady).not.toHaveBeenCalled()
  })
})

// ─── Rejections ───────────────────────────────────────────────────────────────
// Unusable files used to be dropped on the floor: handleFile just returned, so
// nothing happened at all and the parent had nothing to act on.

describe('UploadZone — rejections', () => {
  const fileOfSize = (bytes: number, name = 'letter.pdf', type = 'application/pdf') =>
    new File([new ArrayBuffer(bytes)], name, { type })

  const pickFile = async (user: ReturnType<typeof userEvent.setup>, file: File) => {
    const input = document.querySelector<HTMLInputElement>('input[type="file"]:not([capture])')!
    await user.upload(input, file)
  }

  it('refuses an oversized file before it is ever uploaded', async () => {
    const { user } = setup()
    await pickFile(user, fileOfSize(MAX_FILE_SIZE_BYTES + 1))

    // Catching it here matters twice over: Vercel rejects an oversized body at the
    // edge with an opaque 413 the route can't explain, and we avoid pushing a
    // doomed file over a phone connection.
    expect(onFileReady).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent(/the limit is 4\.4 MB/i)
  })

  it('names the actual size so the parent knows how far over they are', async () => {
    const { user } = setup()
    await pickFile(user, fileOfSize(6 * 1024 * 1024))

    expect(screen.getByRole('alert')).toHaveTextContent(/6\.0 MB/)
  })

  it('accepts a 4.41 MB file — the real-world case this limit was sized for', async () => {
    const { user } = setup()
    await pickFile(user, fileOfSize(4_624_220))

    expect(onFileReady).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('accepts a file exactly at the limit', async () => {
    const { user } = setup()
    await pickFile(user, fileOfSize(MAX_FILE_SIZE_BYTES))

    expect(onFileReady).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('explains an unsupported file type instead of silently ignoring it', () => {
    setup()
    // Dropped rather than picked: the file input carries an `accept` attribute, so
    // userEvent.upload filters a text/plain file out before any event fires. Drag
    // and drop has no such filter, which is exactly why the guard has to exist.
    const zone = screen.getByRole('button', { name: /upload a school letter/i })
    const dropEvent = new Event('drop', { bubbles: true }) as unknown as React.DragEvent
    Object.defineProperty(dropEvent, 'dataTransfer', {
      value: { files: [fileOfSize(100, 'notes.txt', 'text/plain')] },
    })
    act(() => {
      zone.dispatchEvent(dropEvent as unknown as Event)
    })

    expect(onFileReady).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent(/isn.t supported/i)
  })

  it('clears the rejection once a good file is chosen', async () => {
    const { user } = setup()
    await pickFile(user, fileOfSize(MAX_FILE_SIZE_BYTES + 1))
    expect(screen.getByRole('alert')).toBeInTheDocument()

    await pickFile(user, fileOfSize(1024))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(onFileReady).toHaveBeenCalledTimes(1)
  })

  it('shows the size limit up front, before anything is picked', () => {
    setup()
    // Finding out about the limit only AFTER picking a file is the frustrating
    // version of this, so the number has to be visible on the idle screen.
    expect(screen.getByText(/maximum file size 4\.4 MB/i)).toBeInTheDocument()
  })
})
