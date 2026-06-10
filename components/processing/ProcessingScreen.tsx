'use client'

import { useEffect, useState } from 'react'
import { CheckIcon } from '@/components/icons'

const MSGS = [
  'Scanning your document…',
  'Looking for dates and times…',
  'Reading event details…',
  'Finishing up…',
]

const TOTAL_MS = 9000
const MAX_PROGRESS = 80

interface ProcessingScreenProps {
  filename: string
}

export default function ProcessingScreen({ filename }: ProcessingScreenProps) {
  const [step, setStep] = useState(0)
  const [progress, setProgress] = useState(5)

  useEffect(() => {
    const timers = MSGS.slice(1).map((_, i) => {
      const ms = Math.round(TOTAL_MS * (i + 1) / MSGS.length)
      const p  = Math.round(MAX_PROGRESS * (i + 1) / (MSGS.length - 1))
      return setTimeout(() => { setStep(i + 1); setProgress(p) }, ms)
    })
    return () => timers.forEach(clearTimeout)
  }, [])

  return (
    <div className="flex flex-col items-center">
      <div className="bg-surface border border-line rounded-[28px] px-7 py-9 text-center shadow-md w-full">

        {/* Animated document illustration */}
        <div className="flex justify-center mb-7">
          <div className="proc-doc w-[68px] h-[86px] bg-surface rounded-[6px] border-[1.5px] border-line shadow-md relative overflow-hidden">
            <div className="scan-beam" />
            <div className="p-[10px_8px] flex flex-col gap-[6px]">
              {[100, 80, 55, 90, 70, 65].map((w, i) => (
                <div
                  key={i}
                  className="h-[2.5px] bg-line rounded-sm"
                  style={{ width: `${w}%` }}
                />
              ))}
            </div>
          </div>
        </div>

        <h2 className="text-[20px] font-bold tracking-[-0.3px] text-ink mb-1">
          Reading your letter
        </h2>
        <p className="text-[13px] text-ink-subtle mb-5 overflow-hidden text-ellipsis whitespace-nowrap">
          {filename}
        </p>

        {/* Step messages */}
        <div className="flex flex-col gap-[7px] text-left mb-5">
          {MSGS.map((msg, i) => {
            const state = i < step ? 'done' : i === step ? 'active' : 'pending'
            return (
              <div key={i} className={`proc-msg ${state} flex items-center gap-2 text-[13px]`}>
                <span className="w-4 h-4 shrink-0 flex items-center justify-center">
                  {state === 'done' ? (
                    <span className="text-success w-4 h-4 flex">
                      <CheckIcon />
                    </span>
                  ) : (
                    <span className="w-[6px] h-[6px] rounded-full bg-current block" />
                  )}
                </span>
                {msg}
              </div>
            )
          })}
        </div>

        {/* Progress bar */}
        <div className="h-1 bg-primary-light rounded-sm overflow-hidden mb-3">
          <div
            className="h-full bg-primary rounded-sm"
            style={{ width: `${progress}%`, transition: 'width 600ms ease' }}
          />
        </div>

        <p className="text-xs text-ink-subtle">Usually takes about 10 seconds</p>
      </div>
    </div>
  )
}
