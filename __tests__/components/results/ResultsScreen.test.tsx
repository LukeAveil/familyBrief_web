import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ResultsScreen from '@/components/results/ResultsScreen'
import { MOCK_SINGLE, MOCK_MULTIPLE } from '@/lib/mock-data'

// Two-event fixture for multi-select flow tests
const TWO_EVENTS = MOCK_MULTIPLE.slice(0, 2)

const onReset = jest.fn()

beforeEach(() => {
  jest.useFakeTimers()
  jest.spyOn(window, 'open').mockImplementation(() => null)
})

afterEach(() => {
  jest.useRealTimers()
  jest.restoreAllMocks()
  jest.clearAllMocks()
})

// userEvent configured to advance fake timers for its own internal delays
const setupUser = () =>
  userEvent.setup({ advanceTimers: (ms) => jest.advanceTimersByTime(ms) })

// Flush component setTimeout callbacks and the resulting React state updates
const advanceTimers = () => act(() => { jest.runAllTimers() })

// ─── Single-event ─────────────────────────────────────────────────────────────

describe('ResultsScreen — single event', () => {
  it('shows the Add to Google Calendar link', () => {
    render(<ResultsScreen filename="letter.png" events={MOCK_SINGLE} onReset={onReset} />)
    expect(screen.getByRole('link', { name: /add to google calendar/i })).toBeInTheDocument()
  })

  it('shows the success banner and hides the CTA after clicking the link', async () => {
    const user = setupUser()
    render(<ResultsScreen filename="letter.png" events={MOCK_SINGLE} onReset={onReset} />)
    await user.click(screen.getByRole('link', { name: /add to google calendar/i }))
    expect(screen.getByText('Added to Google Calendar')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /add to google calendar/i })).not.toBeInTheDocument()
  })
})

// ─── Multi-event initial state ─────────────────────────────────────────────────

describe('ResultsScreen — multi-event initial state', () => {
  it('renders all toggle buttons as selected by default', () => {
    render(<ResultsScreen filename="letter.png" events={TWO_EVENTS} onReset={onReset} />)
    const deselect = screen.getAllByRole('button', { name: 'Deselect event' })
    expect(deselect).toHaveLength(2)
  })

  it('shows "Add all N events" when all are selected', () => {
    render(<ResultsScreen filename="letter.png" events={TWO_EVENTS} onReset={onReset} />)
    expect(screen.getByRole('button', { name: /add all 2 events/i })).toBeInTheDocument()
  })
})

// ─── Multi-event checkbox toggling ───────────────────────────────────────────

describe('ResultsScreen — checkbox toggling', () => {
  it('updates the button label when one event is deselected', async () => {
    const user = setupUser()
    render(<ResultsScreen filename="letter.png" events={TWO_EVENTS} onReset={onReset} />)
    const [firstToggle] = screen.getAllByRole('button', { name: 'Deselect event' })
    await user.click(firstToggle)
    expect(screen.getByRole('button', { name: /add 1 event$/i })).toBeInTheDocument()
  })

  it('disables the Add button and shows prompt when all events are deselected', async () => {
    const user = setupUser()
    render(<ResultsScreen filename="letter.png" events={TWO_EVENTS} onReset={onReset} />)
    for (const btn of screen.getAllByRole('button', { name: 'Deselect event' })) {
      await user.click(btn)
    }
    const addBtn = screen.getByRole('button', { name: /select events to add/i })
    expect(addBtn).toBeDisabled()
  })
})

// ─── Adding a subset ──────────────────────────────────────────────────────────

describe('ResultsScreen — adding a subset of events', () => {
  const renderAndAddFirst = async () => {
    const user = setupUser()
    render(<ResultsScreen filename="letter.png" events={TWO_EVENTS} onReset={onReset} />)
    // Deselect the second event so only event 1 will be added
    const [, secondToggle] = screen.getAllByRole('button', { name: 'Deselect event' })
    await user.click(secondToggle)
    await user.click(screen.getByRole('button', { name: /add 1 event/i }))
    advanceTimers()
    return { user }
  }

  it('opens the calendar URL for the selected event only', async () => {
    await renderAndAddFirst()
    expect(window.open).toHaveBeenCalledTimes(1)
    expect(window.open).toHaveBeenCalledWith(
      expect.stringContaining(encodeURIComponent(TWO_EVENTS[0].title)),
      '_blank',
    )
  })

  it('marks the added card as disabled', async () => {
    await renderAndAddFirst()
    expect(screen.getByRole('button', { name: 'Added to calendar' })).toBeDisabled()
  })

  it('leaves the remaining card interactive', async () => {
    await renderAndAddFirst()
    // Event 2 was deselected before add, so its button now says "Select event"
    const remaining = screen.getByRole('button', { name: 'Select event' })
    expect(remaining).not.toBeDisabled()
  })

  it('shows the success banner after adding', async () => {
    await renderAndAddFirst()
    expect(screen.getByText('Added to Google Calendar')).toBeInTheDocument()
  })

  it('keeps the Add CTA visible while events remain unadded', async () => {
    await renderAndAddFirst()
    // CTA should still be present (event 2 not yet added)
    expect(screen.getByRole('button', { name: /select events to add/i })).toBeInTheDocument()
  })
})

// ─── Adding all events ────────────────────────────────────────────────────────

describe('ResultsScreen — adding all events', () => {
  it('hides the Add CTA after all events are added', async () => {
    const user = setupUser()
    render(<ResultsScreen filename="letter.png" events={TWO_EVENTS} onReset={onReset} />)
    // Add all events in one click (both selected by default)
    await user.click(screen.getByRole('button', { name: /add all 2 events/i }))
    advanceTimers()
    // The CTA button (Add all / Add N / Select events) should be gone; card buttons are unaffected
    expect(
      screen.queryByRole('button', { name: /add all \d+ events|add \d+ events?|select events to add/i }),
    ).not.toBeInTheDocument()
  })
})

// ─── No duplicate opens ───────────────────────────────────────────────────────

describe('ResultsScreen — no duplicate calendar opens', () => {
  it('does not re-open an already-added event when adding the remaining one', async () => {
    const user = setupUser()
    render(<ResultsScreen filename="letter.png" events={TWO_EVENTS} onReset={onReset} />)

    // Step 1: deselect event 2, add event 1
    const [, secondToggle] = screen.getAllByRole('button', { name: 'Deselect event' })
    await user.click(secondToggle)
    await user.click(screen.getByRole('button', { name: /add 1 event/i }))
    advanceTimers()

    // window.open called once so far (event 1)
    expect(window.open).toHaveBeenCalledTimes(1)

    // Step 2: select and add event 2
    await user.click(screen.getByRole('button', { name: 'Select event' }))
    await user.click(screen.getByRole('button', { name: /add 1 event/i }))
    advanceTimers()

    // window.open called exactly once more (event 2 only — event 1 is not re-opened)
    expect(window.open).toHaveBeenCalledTimes(2)
    expect(window.open).toHaveBeenLastCalledWith(
      expect.stringContaining(encodeURIComponent(TWO_EVENTS[1].title)),
      '_blank',
    )
  })
})
