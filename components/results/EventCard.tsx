'use client'

import type { CalendarEvent } from '@/types'
import { CalendarIcon, ClockIcon, PinIcon, InfoIcon } from '@/components/icons'

interface EventCardProps {
  event: CalendarEvent
  selected?: boolean
  onToggle?: () => void
  compact?: boolean
}

export default function EventCard({ event, selected, onToggle, compact }: EventCardProps) {
  const cardClass = [
    'event-card',
    'bg-surface border-[1.5px] border-line rounded-xl relative shadow-sm',
    compact ? 'p-[14px_16px]' : 'p-5',
    onToggle ? 'pr-[52px]' : '',
    selected ? 'selected' : '',
    event.confidence === 'medium' ? 'uncertain' : '',
  ].filter(Boolean).join(' ')

  return (
    <article className={cardClass}>
      {onToggle && (
        <button
          className="absolute top-4 right-[14px] p-1 rounded-md flex"
          onClick={onToggle}
          aria-label={selected ? 'Deselect event' : 'Select event'}
        >
          <span
            className={`check-box w-[22px] h-[22px] rounded-[6px] border-[1.5px] flex items-center justify-center ${selected ? 'bg-primary border-primary' : 'bg-surface border-line-strong'}`}
          >
            {selected && (
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
          </h3>
          {event.confidence === 'medium' && (
            <span className="inline-flex items-center gap-1 text-[11px] text-amber bg-amber-light border border-amber-line rounded-full px-2 py-[2px] mt-[5px]">
              <span className="w-[11px] h-[11px] flex">
                <InfoIcon />
              </span>
              Please verify the date
            </span>
          )}
        </div>
      </div>

      {/* Details */}
      <dl className="flex flex-col gap-[6px]">
        <div className="flex items-start gap-2 text-sm text-ink-muted min-w-0">
          <dt className="w-4 h-4 shrink-0 mt-[1px] text-ink-subtle flex">
            <CalendarIcon />
          </dt>
          <dd className="min-w-0 flex-1">{event.date}</dd>
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
            <dd className="min-w-0 flex-1">{event.location}</dd>
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
