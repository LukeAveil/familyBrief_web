'use client'

import { useRef, useState } from 'react'
import DocIllustration from '@/components/DocIllustration'
import { UploadIcon, CameraIcon } from '@/components/icons'
import { buildAcceptAttr, acceptedExtensionsLabel } from '@/lib/file-config'

interface UploadZoneProps {
  onUploadSuccess: (filename: string) => void
  onUploadError: (filename: string) => void
}

export default function UploadZone({ onUploadSuccess, onUploadError }: UploadZoneProps) {
  const [drag, setDrag] = useState(false)
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const cameraRef = useRef<HTMLInputElement>(null)

  const handleFile = async (f: File | null | undefined) => {
    if (!f || uploading) return
    setUploading(true)
    try {
      const body = new FormData()
      body.append('file', f)
      const res = await fetch('/api/upload', { method: 'POST', body })
      const data = await res.json()
      if (data.ok) {
        onUploadSuccess(data.filename)
      } else {
        onUploadError(f.name)
      }
    } catch {
      onUploadError(f.name)
    } finally {
      setUploading(false)
    }
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDrag(false)
    handleFile(e.dataTransfer.files[0])
  }

  const acceptAttr = buildAcceptAttr()

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label="Upload a school letter"
      aria-busy={uploading}
      className={`upload-zone border-2 border-dashed border-line-strong rounded-[28px] bg-surface px-6 pt-9 pb-7 text-center cursor-pointer${drag ? ' drag-active' : ''}${uploading ? ' pointer-events-none opacity-70' : ''}`}
      onDragOver={(e) => { e.preventDefault(); if (!uploading) setDrag(true) }}
      onDragLeave={() => setDrag(false)}
      onDrop={handleDrop}
      onClick={() => !uploading && fileRef.current?.click()}
      onKeyDown={(e) => e.key === 'Enter' && !uploading && fileRef.current?.click()}
    >
      {/* Standard file picker */}
      <input
        ref={fileRef}
        type="file"
        accept={acceptAttr}
        onChange={(e) => handleFile(e.target.files?.[0])}
        className="hidden"
      />
      {/* Camera input — mobile: opens camera directly; desktop: falls back to file picker */}
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={(e) => handleFile(e.target.files?.[0])}
        className="hidden"
      />

      <div className="mb-4 flex justify-center leading-none">
        <DocIllustration />
      </div>

      <span className="block text-[16px] font-semibold text-ink mb-1">
        {uploading ? 'Uploading…' : 'Drop your letter here'}
      </span>
      <span className="block text-sm text-ink-muted mb-[22px]">
        {uploading ? 'Please wait' : 'or tap to choose a file'}
      </span>

      <div className="upload-actions flex gap-[10px] justify-center flex-wrap">
        <button
          disabled={uploading}
          className="btn-primary-base inline-flex items-center justify-center gap-[7px] bg-primary text-white px-5 py-[11px] rounded-lg text-[15px] font-semibold whitespace-nowrap disabled:opacity-50"
          onClick={(e) => { e.stopPropagation(); fileRef.current?.click() }}
        >
          <span className="w-[18px] h-[18px] flex items-center shrink-0">
            <UploadIcon />
          </span>
          {uploading ? 'Uploading…' : 'Choose file'}
        </button>
        <button
          disabled={uploading}
          className="btn-secondary-base inline-flex items-center gap-[7px] text-primary px-5 py-[10px] rounded-lg text-[15px] font-medium border-[1.5px] border-line-strong whitespace-nowrap disabled:opacity-50"
          onClick={(e) => { e.stopPropagation(); cameraRef.current?.click() }}
        >
          <span className="w-[18px] h-[18px] flex items-center shrink-0">
            <CameraIcon />
          </span>
          Take photo
        </button>
      </div>

      <p className="mt-4 text-xs text-ink-subtle">Accepts {acceptedExtensionsLabel()}</p>
    </div>
  )
}
