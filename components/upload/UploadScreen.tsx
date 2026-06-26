import UploadZone from './UploadZone'

interface UploadScreenProps {
  onFileReady: (file: File) => void
}

export default function UploadScreen({ onFileReady }: UploadScreenProps) {
  return (
    <div className="upload-page">
      <div className="upload-tagline mb-6">
        <h1 className="text-[26px] font-bold tracking-[-0.5px] leading-[1.2] mb-[10px] text-ink">
          School letters, sorted.
        </h1>
        <p className="text-[15px] text-ink-muted leading-[1.6]">
          Upload a letter from school — we&apos;ll pull out every event and get it into your calendar in one tap.
        </p>
      </div>

      <UploadZone onFileReady={onFileReady} />
    </div>
  )
}
