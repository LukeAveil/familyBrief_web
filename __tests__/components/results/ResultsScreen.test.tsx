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

  it('hides the CTA after adding a subset when the rest are deliberately deselected', async () => {
    await renderAndAddFirst()
    // ev2 was deselected before the add — the component treats it as "user is done"
    expect(
      screen.queryByRole('button', { name: /add all \d+ events|add \d+ events?|select events to add/i }),
    ).not.toBeInTheDocument()
  })
})

// ─── Adding all events (desktop) ─────────────────────────────────────────────

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

// ─── Adding events on mobile ──────────────────────────────────────────────────

const MOBILE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15'

describe('ResultsScreen — mobile sequential add', () => {
  const realUA = navigator.userAgent

  beforeEach(() => {
    Object.defineProperty(navigator, 'userAgent', { value: MOBILE_UA, configurable: true })
  })

  afterEach(() => {
    Object.defineProperty(navigator, 'userAgent', { value: realUA, configurable: true })
  })

  it('opens the first event immediately and shows an Add next event button', async () => {
    const user = setupUser()
    render(<ResultsScreen filename="letter.png" events={TWO_EVENTS} onReset={onReset} />)
    await user.click(screen.getByRole('button', { name: /add all 2 events/i }))
    expect(window.open).toHaveBeenCalledTimes(1)
    expect(window.open).toHaveBeenCalledWith(
      expect.stringContaining(encodeURIComponent(TWO_EVENTS[0].title)),
      '_blank',
    )
    expect(screen.getByRole('button', { name: /add next event/i })).toBeInTheDocument()
  })

  it('opens the queued event on the next tap and hides the CTA when done', async () => {
    const user = setupUser()
    render(<ResultsScreen filename="letter.png" events={TWO_EVENTS} onReset={onReset} />)
    await user.click(screen.getByRole('button', { name: /add all 2 events/i }))
    await user.click(screen.getByRole('button', { name: /add next event/i }))
    expect(window.open).toHaveBeenCalledTimes(2)
    expect(window.open).toHaveBeenLastCalledWith(
      expect.stringContaining(encodeURIComponent(TWO_EVENTS[1].title)),
      '_blank',
    )
    expect(
      screen.queryByRole('button', { name: /add (all \d+|\d+) events?|add next event|select events to add/i }),
    ).not.toBeInTheDocument()
  })

  it('shows progress in the Add next event button label', async () => {
    const [, , thirdEvent] = MOCK_MULTIPLE
    const THREE_EVENTS = [...TWO_EVENTS, thirdEvent]
    const user = setupUser()
    render(<ResultsScreen filename="letter.png" events={THREE_EVENTS} onReset={onReset} />)
    await user.click(screen.getByRole('button', { name: /add all 3 events/i }))
    // After first: "Add next event (2 of 3)"
    expect(screen.getByRole('button', { name: /add next event \(2 of 3\)/i })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /add next event/i }))
    // After second: "Add next event (3 of 3)"
    expect(screen.getByRole('button', { name: /add next event \(3 of 3\)/i })).toBeInTheDocument()
  })
})

// ─── iPad sequential add (desktop UA, maxTouchPoints > 0) ────────────────────

const IPAD_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15'

describe('ResultsScreen — iPad sequential add', () => {
  const realUA = navigator.userAgent

  beforeEach(() => {
    Object.defineProperty(navigator, 'userAgent', { value: IPAD_UA, configurable: true })
    Object.defineProperty(navigator, 'maxTouchPoints', { value: 5, configurable: true })
  })

  afterEach(() => {
    Object.defineProperty(navigator, 'userAgent', { value: realUA, configurable: true })
    Object.defineProperty(navigator, 'maxTouchPoints', { value: 0, configurable: true })
  })

  it('uses the mobile sequential flow on iPad despite the desktop UA', async () => {
    const user = setupUser()
    render(<ResultsScreen filename="letter.png" events={TWO_EVENTS} onReset={onReset} />)
    await user.click(screen.getByRole('button', { name: /add all 2 events/i }))
    // Mobile path: only the first event opens immediately — no stagger setTimeout
    expect(window.open).toHaveBeenCalledTimes(1)
    expect(window.open).toHaveBeenCalledWith(
      expect.stringContaining(encodeURIComponent(TWO_EVENTS[0].title)),
      '_blank',
    )
    expect(screen.getByRole('button', { name: /add next event/i })).toBeInTheDocument()
  })
})

// ─── Mobile batch progress label ──────────────────────────────────────────────

describe('ResultsScreen — mobile batch progress label', () => {
  const realUA = navigator.userAgent

  beforeEach(() => {
    Object.defineProperty(navigator, 'userAgent', { value: MOBILE_UA, configurable: true })
  })

  afterEach(() => {
    Object.defineProperty(navigator, 'userAgent', { value: realUA, configurable: true })
  })

  it('counts from 1 within the current batch even when a prior event was already added', async () => {
    const [, , thirdEvent] = MOCK_MULTIPLE
    const THREE_EVENTS = [...TWO_EVENTS, thirdEvent]
    const user = setupUser()
    render(<ResultsScreen filename="letter.png" events={THREE_EVENTS} onReset={onReset} />)

    // Deselect ev2+ev3, add ev1 via the "Add 1 event" button (desktop path)
    const [, secondToggle, thirdToggle] = screen.getAllByRole('button', { name: 'Deselect event' })
    await user.click(secondToggle)
    await user.click(thirdToggle)
    await user.click(screen.getByRole('button', { name: /add 1 event/i }))
    advanceTimers()

    // Now re-select ev2 and ev3 and tap "Add 2 events" (mobile path)
    for (const btn of screen.getAllByRole('button', { name: 'Select event' })) {
      await user.click(btn)
    }
    await user.click(screen.getByRole('button', { name: /add 2 events/i }))

    // Batch is 2 events — label should say "2 of 2", not "3 of 3"
    expect(screen.getByRole('button', { name: /add next event \(2 of 2\)/i })).toBeInTheDocument()
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
