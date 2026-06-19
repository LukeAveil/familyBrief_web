import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import UploadZone from '@/components/upload/UploadZone'

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
