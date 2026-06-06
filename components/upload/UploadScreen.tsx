import type { LayoutStyle } from '@/types'
import StepsStrip from './StepsStrip'
import UploadZone from './UploadZone'

interface UploadScreenProps {
  onFileSelect: (filename: string) => void
  layout?: LayoutStyle
}

const DEMO_PILLS = [
  { label: '1 event',    filename: 'sports-day.pdf' },
  { label: '3 events',  filename: 'summer-newsletter.pdf' },
  { label: 'Error state', filename: 'blurry-photo.jpg' },
]

export default function UploadScreen({ onFileSelect, layout = 'focus' }: UploadScreenProps) {
  return (
    <div className={`upload-page${layout === 'airy' ? ' layout-airy' : ''}`}>
      {layout === 'structured' ? (
        <StepsStrip />
      ) : (
        <div className="upload-tagline mb-6">
          <h1 className="text-[26px] font-bold tracking-[-0.5px] leading-[1.2] mb-[10px] text-ink">
            School letters, sorted.
          </h1>
          <p className="text-[15px] text-ink-muted leading-[1.6]">
            Upload a letter from school — we&apos;ll pull out every event and get it into your calendar in one tap.
          </p>
        </div>
      )}

      <div>
        <UploadZone onFileSelect={onFileSelect} />

        <div className="flex items-center gap-2 mt-[18px] flex-wrap justify-center">
          <span className="text-xs text-ink-subtle">Try a demo:</span>
          {DEMO_PILLS.map(({ label, filename }) => (
            <button
              key={label}
              className="text-xs text-primary px-[10px] py-[3px] rounded-full border border-primary-mid bg-surface hover:bg-primary-light transition-colors"
              onClick={() => onFileSelect(filename)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
