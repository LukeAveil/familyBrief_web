import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import EventCard from '@/components/results/EventCard'
import { MOCK_SINGLE } from '@/lib/mock-data'

const EVENT = MOCK_SINGLE[0]

const setup = (props: Partial<Parameters<typeof EventCard>[0]> = {}) => {
  const user = userEvent.setup()
  render(<EventCard event={EVENT} {...props} />)
  return { user }
}

describe('EventCard — checkbox visibility', () => {
  it('renders no checkbox when onToggle and calendarAdded are absent', () => {
    setup()
    expect(
      screen.queryByRole('button', { name: /select event|deselect event|added to calendar/i }),
    ).not.toBeInTheDocument()
  })

  it('renders a checkbox button when onToggle is provided', () => {
    setup({ onToggle: jest.fn(), selected: false })
    expect(screen.getByRole('button', { name: 'Select event' })).toBeInTheDocument()
  })

  it('renders a disabled checkbox when calendarAdded is true', () => {
    setup({ calendarAdded: true, selected: true })
    expect(screen.getByRole('button', { name: 'Added to calendar' })).toBeDisabled()
  })
})

describe('EventCard — checkbox visual state (unchecked)', () => {
  it('applies bg-surface and border-line-strong when selected is false', () => {
    setup({ onToggle: jest.fn(), selected: false })
    const btn = screen.getByRole('button', { name: 'Select event' })
    const span = btn.querySelector('span')!
    expect(span).toHaveClass('bg-surface', 'border-line-strong')
    expect(span).not.toHaveClass('bg-primary')
  })

  it('does not render the checkmark svg when unselected', () => {
    setup({ onToggle: jest.fn(), selected: false })
    const btn = screen.getByRole('button', { name: 'Select event' })
    expect(btn.querySelector('svg')).toBeNull()
  })
})

describe('EventCard — checkbox visual state (checked)', () => {
  it('applies bg-primary and border-primary when selected is true', () => {
    setup({ onToggle: jest.fn(), selected: true })
    const btn = screen.getByRole('button', { name: 'Deselect event' })
    const span = btn.querySelector('span')!
    expect(span).toHaveClass('bg-primary', 'border-primary')
    expect(span).not.toHaveClass('bg-surface')
  })

  it('renders the checkmark svg when selected is true', () => {
    setup({ onToggle: jest.fn(), selected: true })
    const btn = screen.getByRole('button', { name: 'Deselect event' })
    expect(btn.querySelector('svg')).toBeTruthy()
  })
})

describe('EventCard — checkbox visual state (calendarAdded)', () => {
  it('applies bg-primary to the span when calendarAdded is true', () => {
    setup({ calendarAdded: true, selected: true })
    const btn = screen.getByRole('button', { name: 'Added to calendar' })
    const span = btn.querySelector('span')!
    expect(span).toHaveClass('bg-primary', 'border-primary')
  })

  it('renders the checkmark svg when calendarAdded is true', () => {
    setup({ calendarAdded: true, selected: true })
    const btn = screen.getByRole('button', { name: 'Added to calendar' })
    expect(btn.querySelector('svg')).toBeTruthy()
  })

  it('does not call onToggle when the disabled button is clicked', async () => {
    const onToggle = jest.fn()
    const { user } = setup({ calendarAdded: true, selected: true, onToggle })
    await user.click(screen.getByRole('button', { name: 'Added to calendar' }))
    expect(onToggle).not.toHaveBeenCalled()
  })
})

describe('EventCard — interaction', () => {
  it('calls onToggle when the checkbox button is clicked', async () => {
    const onToggle = jest.fn()
    const { user } = setup({ onToggle, selected: false })
    await user.click(screen.getByRole('button', { name: 'Select event' }))
    expect(onToggle).toHaveBeenCalledTimes(1)
  })
})
