const STEPS = [
  { label: 'Upload a letter', sub: 'PDF, image or photo' },
  { label: 'We read it for you', sub: 'AI finds every event' },
  { label: 'Add to calendar', sub: 'One tap to Google' },
]

export default function StepsStrip() {
  return (
    <div className="steps-strip flex items-stretch bg-surface border border-line rounded-xl p-4 mb-5 shadow-sm">
      {STEPS.map((step, i) => (
        <div key={i} className="contents">
          <div className="flex items-start gap-[10px] flex-1 min-w-0">
            <span className="w-[26px] h-[26px] rounded-full bg-primary-light text-primary text-[12px] font-bold flex items-center justify-center shrink-0">
              {i + 1}
            </span>
            <div>
              <div className="text-[13px] font-semibold text-ink">{step.label}</div>
              <div className="text-[11px] text-ink-subtle mt-0.5">{step.sub}</div>
            </div>
          </div>
          {i < STEPS.length - 1 && (
            <span className="step-sep self-center text-line-strong text-base px-[6px] shrink-0">›</span>
          )}
        </div>
      ))}
    </div>
  )
}
