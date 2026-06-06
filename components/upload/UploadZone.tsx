'use client'

import { useRef, useState } from 'react'
import DocIllustration from '@/components/DocIllustration'
import { UploadIcon, CameraIcon } from '@/components/icons'

interface UploadZoneProps {
  onFileSelect: (filename: string) => void
}

export default function UploadZone({ onFileSelect }: UploadZoneProps) {
  const [drag, setDrag] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const handleFile = (f: File | null | undefined) => {
    if (f) onFileSelect(f.name)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDrag(false)
    handleFile(e.dataTransfer.files[0])
  }

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label="Upload a school letter"
      className={`upload-zone border-2 border-dashed border-line-strong rounded-[28px] bg-surface px-6 pt-9 pb-7 text-center cursor-pointer${drag ? ' drag-active' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setDrag(true) }}
      onDragLeave={() => setDrag(false)}
      onDrop={handleDrop}
      onClick={() => fileRef.current?.click()}
      onKeyDown={(e) => e.key === 'Enter' && fileRef.current?.click()}
    >
      <input
        ref={fileRef}
        type="file"
        accept="image/*,application/pdf"
        onChange={(e) => handleFile(e.target.files?.[0])}
        className="hidden"
      />

      <div className="mb-4 flex justify-center leading-none">
        <DocIllustration />
      </div>

      <span className="block text-[16px] font-semibold text-ink mb-1">Drop your letter here</span>
      <span className="block text-sm text-ink-muted mb-[22px]">or tap to choose a file</span>

      <div className="upload-actions flex gap-[10px] justify-center flex-wrap">
        <button
          className="btn-primary-base inline-flex items-center justify-center gap-[7px] bg-primary text-white px-5 py-[11px] rounded-lg text-[15px] font-semibold whitespace-nowrap"
          onClick={(e) => { e.stopPropagation(); fileRef.current?.click() }}
        >
          <span className="w-[18px] h-[18px] flex items-center shrink-0">
            <UploadIcon />
          </span>
          Choose file
        </button>
        <button
          className="btn-secondary-base inline-flex items-center gap-[7px] text-primary px-5 py-[10px] rounded-lg text-[15px] font-medium border-[1.5px] border-line-strong whitespace-nowrap"
          onClick={(e) => { e.stopPropagation(); onFileSelect('photo.jpg') }}
        >
          <span className="w-[18px] h-[18px] flex items-center shrink-0">
            <CameraIcon />
          </span>
          Take photo
        </button>
      </div>

      <p className="mt-4 text-xs text-ink-subtle">Accepts JPG, PNG and PDF</p>
    </div>
  )
}
