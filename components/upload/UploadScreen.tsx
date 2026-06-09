import type { LayoutStyle } from '@/types'
import StepsStrip from './StepsStrip'
import UploadZone from './UploadZone'

interface UploadScreenProps {
  onUploadSuccess: (filename: string) => void
  onUploadError: (filename: string) => void
  layout?: LayoutStyle
}

export default function UploadScreen({ onUploadSuccess, onUploadError, layout = 'focus' }: UploadScreenProps) {
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

      <UploadZone onUploadSuccess={onUploadSuccess} onUploadError={onUploadError} />
    </div>
  )
}
