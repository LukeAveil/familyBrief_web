'use client'

import type { CalendarEvent, ConfidenceLevel } from '@/types'
import { CalendarIcon, ClockIcon, PinIcon, InfoIcon, AlertIcon } from '@/components/icons'

interface EventCardProps {
  event: CalendarEvent
  selected?: boolean
  onToggle?: () => void
  calendarAdded?: boolean
  compact?: boolean
}

/**
 * Inline flag that makes a field's model-assessed confidence visible. `high`
 * renders nothing (the default, trusted look). `medium` and `low` get a small
 * pill escalating from amber to red, each carrying an icon AND a text label so
 * the meaning never depends on colour alone. `field` names what is uncertain so
 * the short label reads unambiguously next to the value it sits beside.
 */
function ConfidenceFlag({ level, field }: { level: ConfidenceLevel; field: string }) {
  if (level === 'high') return null

  const isLow = level === 'low'
  const label = isLow ? 'Low confidence — verify' : 'Double-check'
  const tone = isLow
    ? 'text-error bg-error-light border-error-line'
    : 'text-amber bg-amber-light border-amber-line'

  return (
    <span
      className={`inline-flex items-center gap-1 align-middle text-[11px] ${tone} border rounded-full px-2 py-[2px] ml-2`}
      aria-label={`${isLow ? 'Low' : 'Medium'} confidence in the ${field}`}
    >
      <span className="w-[11px] h-[11px] flex">{isLow ? <AlertIcon /> : <InfoIcon />}</span>
      {label}
    </span>
  )
}

export default function EventCard({
  event,
  selected,
  onToggle,
  calendarAdded,
  compact,
}: EventCardProps) {
  const { confidence } = event

  // Worst confidence across the present fields drives the card-level cue, so a
  // parent can spot which cards need a second look while scanning the list.
  const levels: ConfidenceLevel[] = [
    confidence.title,
    confidence.datetime,
    ...(confidence.location ? [confidence.location] : []),
  ]
  const worst: ConfidenceLevel = levels.includes('low')
    ? 'low'
    : levels.includes('medium')
      ? 'medium'
      : 'high'

  const cardClass = [
    'event-card',
    'bg-surface border-[1.5px] border-line rounded-xl relative shadow-sm',
    compact ? 'p-[14px_16px]' : 'p-5',
    onToggle || calendarAdded ? 'pr-[52px]' : '',
    selected ? 'selected' : '',
    worst !== 'high' ? 'uncertain' : '',
    worst === 'low' ? 'uncertain-low' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <article className={cardClass}>
      {(onToggle || calendarAdded) && (
        <button
          className={`absolute top-4 right-[14px] p-1 rounded-md flex${calendarAdded ? ' opacity-50 cursor-default' : ''}`}
          onClick={onToggle}
          disabled={!!calendarAdded}
          aria-label={
            calendarAdded ? 'Added to calendar' : selected ? 'Deselect event' : 'Select event'
          }
        >
          <span
            className={`check-box w-[22px] h-[22px] rounded-[6px] border-[1.5px] flex items-center justify-center ${selected || calendarAdded ? 'bg-primary border-primary' : 'bg-surface border-line-strong'}`}
          >
            {(selected || calendarAdded) && (
              <svg viewBox="0 0 12 12" width="12" height="12" fill="none">
                <polyline
                  points="2,6.5 4.5,9 10,3"
                  stroke="white"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            )}
          </span>
        </button>
      )}

      {/* Header: icon + title */}
      <div className="flex items-start gap-3 mb-3">
        <div className="w-9 h-9 rounded-md bg-primary-light text-primary flex items-center justify-center shrink-0">
          <span className="w-[18px] h-[18px] flex">
            <CalendarIcon />
          </span>
        </div>
        <div>
          <h3 className="text-[17px] font-semibold tracking-[-0.2px] leading-[1.3] text-ink">
            {event.title}
            <ConfidenceFlag level={confidence.title} field="event name" />
          </h3>
        </div>
      </div>

      {/* Details */}
      <dl className="flex flex-col gap-[6px]">
        <div className="flex items-start gap-2 text-sm text-ink-muted min-w-0">
          <dt className="w-4 h-4 shrink-0 mt-[1px] text-ink-subtle flex">
            <CalendarIcon />
          </dt>
          <dd className="min-w-0 flex-1">
            {event.date}
            {/* The date/time confidence sits on the date row and covers both,
                since the model assesses them as one field. */}
            <ConfidenceFlag level={confidence.datetime} field="date and time" />
          </dd>
        </div>
        {event.time && (
          <div className="flex items-start gap-2 text-sm text-ink-muted min-w-0">
            <dt className="w-4 h-4 shrink-0 mt-[1px] text-ink-subtle flex">
              <ClockIcon />
            </dt>
            <dd className="min-w-0 flex-1">{event.time}</dd>
          </div>
        )}
        {event.location && (
          <div className="flex items-start gap-2 text-sm text-ink-muted min-w-0">
            <dt className="w-4 h-4 shrink-0 mt-[1px] text-ink-subtle flex">
              <PinIcon />
            </dt>
            <dd className="min-w-0 flex-1">
              {event.location}
              {confidence.location && (
                <ConfidenceFlag level={confidence.location} field="location" />
              )}
            </dd>
          </div>
        )}
      </dl>

      {event.notes && !compact && (
        <p className="mt-[10px] pt-[10px] border-t border-line text-[13px] text-ink-subtle leading-[1.5]">
          {event.notes}
        </p>
      )}
    </article>
  )
}
