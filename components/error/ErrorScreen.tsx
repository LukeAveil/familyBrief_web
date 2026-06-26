import { AlertIcon, RefreshIcon } from '@/components/icons'

interface ErrorScreenProps {
  filename: string
  onRetry: () => void
  onReset: () => void
}

const TIPS = [
  'Hold your phone steady and keep the full letter in frame',
  'Even lighting makes a big difference — avoid shadows across the text',
  'If you received the letter by email, the PDF version works best',
]

export default function ErrorScreen({ filename, onRetry, onReset }: ErrorScreenProps) {
  return (
    <div className="text-center py-2">
      {/* Error icon */}
      <div className="w-16 h-16 rounded-full bg-error-light border-[1.5px] border-error-line text-error flex items-center justify-center mx-auto mb-5">
        <span className="w-8 h-8 flex">
          <AlertIcon />
        </span>
      </div>

      <h2 className="text-[22px] font-bold tracking-[-0.4px] text-ink mb-[10px]">
        Couldn&apos;t read that one
      </h2>
      <p className="text-[15px] text-ink-muted leading-[1.6] mb-6">
        We couldn&apos;t read <span className="font-medium text-ink">{filename}</span>. The image may be too blurry, low-contrast, or cropped. A cleaner photo or a PDF usually works better.
      </p>

      {/* Tips card */}
      <div className="bg-surface border border-line rounded-xl px-5 py-[18px] mb-6 text-left">
        <p className="text-[11px] font-bold text-ink-subtle uppercase tracking-[0.8px] mb-3">
          Tips for a better result
        </p>
        <ul className="flex flex-col gap-2">
          {TIPS.map((tip, i) => (
            <li key={i} className="text-sm text-ink pl-[18px] relative leading-[1.5]">
              <span className="absolute left-[2px] text-primary">–</span>
              {tip}
            </li>
          ))}
        </ul>
      </div>

      {/* Actions */}
      <div className="flex flex-col gap-[10px]">
        <button
          className="btn-primary-base inline-flex items-center justify-center gap-[7px] bg-primary text-white w-full px-5 py-[11px] rounded-lg text-[15px] font-semibold"
          onClick={onRetry}
        >
          <span className="w-[18px] h-[18px] flex items-center">
            <RefreshIcon />
          </span>
          Try again
        </button>
        <button
          className="btn-ghost-base flex items-center justify-center gap-[7px] w-full px-5 py-3 rounded-[20px] text-[15px] font-medium text-ink-muted border border-line bg-transparent"
          onClick={onReset}
        >
          Start fresh
        </button>
      </div>
    </div>
  )
}
