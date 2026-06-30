'use client'

import { useState } from 'react'
import type { CalendarEvent } from '@/types'
import { CalendarIcon, CheckIcon, RefreshIcon, GoogleIcon } from '@/components/icons'
import { isMobileDevice } from '@/lib/device'
import EventCard from './EventCard'

interface ResultsScreenProps {
  filename: string
  events: CalendarEvent[]
  onReset: () => void
  compact?: boolean
}

function buildCalUrl(ev: CalendarEvent): string {
  return (
    'https://calendar.google.com/calendar/render?action=TEMPLATE' +
    `&text=${encodeURIComponent(ev.title)}` +
    `&dates=${ev.cal}` +
    `&details=${encodeURIComponent(ev.notes ?? '')}` +
    `&location=${encodeURIComponent(ev.location ?? '')}`
  )
}

export default function ResultsScreen({ filename, events, onReset, compact }: ResultsScreenProps) {
  const [selected, setSelected] = useState<Set<number>>(() => new Set(events.map(e => e.id)))
  const [addedIds, setAddedIds] = useState<Set<number>>(new Set())
  const [pendingQueue, setPendingQueue] = useState<CalendarEvent[]>([])
  const [batchStart, setBatchStart] = useState(0)
  const [adding, setAdding] = useState(false)


  if (events.length === 0) {
    return (
      <div className="text-center py-2">
        <div className="w-16 h-16 rounded-full bg-primary-light text-primary flex items-center justify-center mx-auto mb-5">
          <span className="w-8 h-8 flex">
            <CalendarIcon />
          </span>
        </div>
        <h2 className="text-[22px] font-bold tracking-[-0.4px] text-ink mb-[10px]">
          No events found
        </h2>
        <p className="text-[15px] text-ink-muted leading-[1.6] mb-6">
          We couldn&apos;t spot any dates or events in <span className="font-medium text-ink">{filename}</span>. This sometimes happens with letters that are mostly information rather than schedules.
        </p>
        <button
          className="btn-primary-base inline-flex items-center justify-center gap-[7px] bg-primary text-white w-full px-5 py-[11px] rounded-lg text-[15px] font-semibold"
          onClick={onReset}
        >
          <span className="w-[18px] h-[18px] flex items-center">
            <RefreshIcon />
          </span>
          Try a different letter
        </button>
      </div>
    )
  }

  const multi = events.length > 1

  const toggle = (id: number) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const handleAddAll = () => {
    const toOpen = events.filter(e => selected.has(e.id) && !addedIds.has(e.id))
    if (toOpen.length === 0) return

    if (isMobileDevice()) {
      // Mobile: open the first event immediately within the user gesture so the
      // OS deep-links to the Calendar app. Remaining events are queued for
      // sequential taps — each tap is its own gesture, avoiding popup blocking.
      // No setAdding needed: the CTA switches to "Add next event" after this
      // render, so the "Add all" button is gone before the user can tap again.
      setBatchStart(addedIds.size)
      window.open(buildCalUrl(toOpen[0]), '_blank')
      setAddedIds(prev => new Set([...prev, toOpen[0].id]))
      setSelected(prev => { const next = new Set(prev); next.delete(toOpen[0].id); return next })
      if (toOpen.length > 1) setPendingQueue(toOpen.slice(1))
    } else {
      // Desktop: stagger opens so the browser doesn't bundle them into one tab.
      setAdding(true)
      toOpen.forEach((ev, i) => setTimeout(() => window.open(buildCalUrl(ev), '_blank'), i * 400))
      setTimeout(() => {
        setAddedIds(prev => new Set([...prev, ...toOpen.map(e => e.id)]))
        setSelected(prev => {
          const next = new Set(prev)
          toOpen.forEach(e => next.delete(e.id))
          return next
        })
        setAdding(false)
      }, toOpen.length * 400)
    }
  }

  const handleAddNext = () => {
    if (pendingQueue.length === 0) return
    const ev = pendingQueue[0]
    // Direct user gesture → deep-links to Calendar app on mobile.
    window.open(buildCalUrl(ev), '_blank')
    setAddedIds(prev => new Set([...prev, ev.id]))
    setSelected(prev => { const next = new Set(prev); next.delete(ev.id); return next })
    setPendingQueue(prev => prev.slice(1))
  }

  // Hide the CTA once the user has added at least one event and every remaining
  // event is either already added or deliberately deselected (not just not-yet-added).
  const allAdded =
    addedIds.size > 0 &&
    pendingQueue.length === 0 &&
    events.every(e => addedIds.has(e.id) || !selected.has(e.id))

  const selCount = selected.size

  // Progress within the current mobile batch (not the global addedIds count).
  const batchAdded = addedIds.size - batchStart
  const batchTotal = batchAdded + pendingQueue.length

  return (
    <div>
      {/* Results header */}
      <div className="flex items-center gap-[14px] mb-5">
        <div className="w-11 h-11 rounded-full bg-success-light text-success flex items-center justify-center shrink-0">
          <span className="w-6 h-6 flex">
            <CheckIcon />
          </span>
        </div>
        <div>
          <h2 className="text-[22px] font-bold tracking-[-0.4px] leading-[1.2] text-ink">
            {events.length === 1 ? 'Found 1 event' : `Found ${events.length} events`}
          </h2>
          <p className="text-[13px] text-ink-subtle mt-0.5">from {filename}</p>
        </div>
      </div>

      {/* Added-to-calendar banner */}
      {addedIds.size > 0 && (
        <div className="added-banner flex items-center gap-3 bg-success-light border border-success-line rounded-xl px-4 py-[14px] mb-4">
          <span className="text-success w-6 h-6 flex shrink-0">
            <CheckIcon />
          </span>
          <div>
            <p className="text-sm font-semibold text-success">Added to Google Calendar</p>
            <p className="text-xs text-ink-subtle mt-0.5">Check your calendar to confirm they appeared</p>
          </div>
        </div>
      )}

      {/* Event list */}
      <div className="flex flex-col gap-3 mb-5">
        {events.map(ev => (
          <EventCard
            key={ev.id}
            event={ev}
            selected={multi ? (addedIds.has(ev.id) || selected.has(ev.id)) : undefined}
            onToggle={multi && !addedIds.has(ev.id) ? () => toggle(ev.id) : undefined}
            calendarAdded={addedIds.has(ev.id)}
            compact={compact}
          />
        ))}
      </div>

      {/* CTA */}
      {pendingQueue.length > 0 ? (
        <div className="mb-[10px]">
          <button
            className="btn-gcal-base flex items-center justify-center gap-[10px] w-full bg-gcal text-white px-6 py-[15px] rounded-xl text-[16px] font-semibold disabled:bg-ink-subtle disabled:cursor-not-allowed"
            onClick={handleAddNext}
          >
            <GoogleIcon />
            Add next event ({batchAdded + 1} of {batchTotal})
          </button>
        </div>
      ) : !allAdded ? (
        <div className="mb-[10px]">
          {!multi ? (
            <a
              className="btn-gcal-base flex items-center justify-center gap-[10px] w-full bg-gcal text-white px-6 py-[15px] rounded-xl text-[16px] font-semibold"
              href={buildCalUrl(events[0])}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setAddedIds(new Set([events[0].id]))}
            >
              <GoogleIcon />
              Add to Google Calendar
            </a>
          ) : (
            <button
              className="btn-gcal-base flex items-center justify-center gap-[10px] w-full bg-gcal text-white px-6 py-[15px] rounded-xl text-[16px] font-semibold disabled:bg-ink-subtle disabled:cursor-not-allowed"
              onClick={handleAddAll}
              disabled={selCount === 0 || adding}
            >
              <GoogleIcon />
              {selCount === 0
                ? 'Select events to add'
                : selCount === events.length
                  ? `Add all ${selCount} events`
                  : `Add ${selCount} event${selCount !== 1 ? 's' : ''}`}
            </button>
          )}
        </div>
      ) : null}

      {/* Reset */}
      <button
        className="btn-ghost-base flex items-center justify-center gap-[7px] w-full px-5 py-3 rounded-[20px] text-[15px] font-medium text-ink-muted border border-line bg-transparent"
        onClick={onReset}
      >
        <span className="w-[18px] h-[18px] flex items-center">
          <RefreshIcon />
        </span>
        Upload another letter
      </button>
    </div>
  )
}
