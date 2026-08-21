/**
 * SignInForm state-machine tests.
 * ────────────────────────────────────────────────────────────────────────────
 * We test the form's four states (idle / loading / sent / error) end-to-end
 * from the user's perspective — type an email, click submit, verify what they
 * see next. The `sendMagicLink` server action is mocked so no real Auth.js is
 * touched.
 */

const mockSendMagicLink = jest.fn()

// Mock the server action via its relative path (matches how SignInForm.tsx
// imports it). Next/jest's `@/` alias doesn't cover jest.mock() at hoist time
// for files reached through a relative import, so we use the same path shape
// SignInForm.tsx uses internally.
jest.mock('../../app/signin/actions', () => ({
  __esModule: true,
  sendMagicLink: (...args: unknown[]) => mockSendMagicLink(...args),
}))

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SignInForm from '@/app/signin/SignInForm'

beforeEach(() => mockSendMagicLink.mockReset())

describe('SignInForm', () => {
  it('renders the idle state with an empty email field', () => {
    render(<SignInForm callbackUrl="/" />)
    expect(screen.getByRole('heading', { name: /sign in to familybrief/i })).toBeInTheDocument()
    const input = screen.getByLabelText(/email/i) as HTMLInputElement
    expect(input.value).toBe('')
    expect(screen.getByRole('button', { name: /send magic link/i })).toBeEnabled()
  })

  it('shows the loading state while the action is in flight', async () => {
    // Never-resolving promise so we can observe the loading state.
    let resolve: (v: { ok: true }) => void = () => {}
    mockSendMagicLink.mockReturnValueOnce(
      new Promise((r) => {
        resolve = r
      }),
    )

    const user = userEvent.setup()
    render(<SignInForm callbackUrl="/" />)
    await user.type(screen.getByLabelText(/email/i), 'jane@example.com')
    await user.click(screen.getByRole('button', { name: /send magic link/i }))

    expect(screen.getByRole('button', { name: /sending/i })).toBeDisabled()
    expect(screen.getByLabelText(/email/i)).toBeDisabled()

    // Cleanly resolve so React doesn't complain about an unhandled promise.
    resolve({ ok: true })
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: /check your inbox/i })).toBeInTheDocument(),
    )
  })

  it('transitions to the sent state and shows the entered email on success', async () => {
    mockSendMagicLink.mockResolvedValueOnce({ ok: true })

    const user = userEvent.setup()
    render(<SignInForm callbackUrl="/" />)
    await user.type(screen.getByLabelText(/email/i), 'jane@example.com')
    await user.click(screen.getByRole('button', { name: /send magic link/i }))

    expect(await screen.findByRole('heading', { name: /check your inbox/i })).toBeInTheDocument()
    expect(screen.getByText('jane@example.com')).toBeInTheDocument()
    // Form is gone; reset link is present.
    expect(screen.queryByLabelText(/email/i)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /use a different email/i })).toBeInTheDocument()
  })

  it('lets the user go back to the form via "Use a different email"', async () => {
    mockSendMagicLink.mockResolvedValueOnce({ ok: true })
    const user = userEvent.setup()
    render(<SignInForm callbackUrl="/" />)
    await user.type(screen.getByLabelText(/email/i), 'jane@example.com')
    await user.click(screen.getByRole('button', { name: /send magic link/i }))
    await screen.findByRole('heading', { name: /check your inbox/i })

    await user.click(screen.getByRole('button', { name: /use a different email/i }))

    // Back to idle: form is present again, and the email field is cleared so
    // the user can type a different address without editing the previous one.
    expect(screen.getByRole('heading', { name: /sign in to familybrief/i })).toBeInTheDocument()
    expect((screen.getByLabelText(/email/i) as HTMLInputElement).value).toBe('')
  })

  it('shows an inline error when the action returns { ok: false } and keeps the form usable', async () => {
    mockSendMagicLink.mockResolvedValueOnce({ ok: false, error: 'Could not send sign-in email.' })

    const user = userEvent.setup()
    render(<SignInForm callbackUrl="/" />)
    await user.type(screen.getByLabelText(/email/i), 'jane@example.com')
    await user.click(screen.getByRole('button', { name: /send magic link/i }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/could not send sign-in email/i)
    // Form is still there — the user can correct and retry.
    expect(screen.getByRole('button', { name: /send magic link/i })).toBeEnabled()
    expect((screen.getByLabelText(/email/i) as HTMLInputElement).value).toBe('jane@example.com')
  })

  it('passes the callbackUrl through to the server action', async () => {
    mockSendMagicLink.mockResolvedValueOnce({ ok: true })
    const user = userEvent.setup()
    render(<SignInForm callbackUrl="/workspace/42" />)
    await user.type(screen.getByLabelText(/email/i), 'jane@example.com')
    await user.click(screen.getByRole('button', { name: /send magic link/i }))
    await waitFor(() => expect(mockSendMagicLink).toHaveBeenCalledTimes(1))
    expect(mockSendMagicLink).toHaveBeenCalledWith('jane@example.com', '/workspace/42')
  })
})
