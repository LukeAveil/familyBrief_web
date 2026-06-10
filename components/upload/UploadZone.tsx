'use client'

import { useEffect, useRef, useState } from 'react'
import DocIllustration from '@/components/DocIllustration'
import { UploadIcon, CameraIcon } from '@/components/icons'
import { buildAcceptAttr, isAcceptedType, acceptedExtensionsLabel } from '@/lib/file-config'

interface UploadZoneProps {
  onFileReady: (file: File) => void
}

export default function UploadZone({ onFileReady }: UploadZoneProps) {
  const [drag, setDrag] = useState(false)
  const [isTouchDevice, setIsTouchDevice] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const cameraRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (window.matchMedia) {
      setIsTouchDevice(window.matchMedia('(hover: none) and (pointer: coarse)').matches)
    }
  }, [])

  const handleFile = (f: File | null | undefined, input?: HTMLInputElement | null) => {
    if (!f) return
    if (!isAcceptedType(f)) return
    if (input) input.value = ''
    onFileReady(f)
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
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileRef.current?.click() } }}
    >
      {/* Standard file picker */}
      <input
        ref={fileRef}
        type="file"
        accept={buildAcceptAttr()}
        onChange={(e) => handleFile(e.target.files?.[0], e.target)}
        className="hidden"
      />
      {/* Camera input — always in DOM so cameraRef stays valid; button only shown on touch devices */}
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={(e) => handleFile(e.target.files?.[0], e.target)}
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
        {isTouchDevice && (
          <button
            className="btn-secondary-base inline-flex items-center gap-[7px] text-primary px-5 py-[10px] rounded-lg text-[15px] font-medium border-[1.5px] border-line-strong whitespace-nowrap"
            onClick={(e) => { e.stopPropagation(); cameraRef.current?.click() }}
          >
            <span className="w-[18px] h-[18px] flex items-center shrink-0">
              <CameraIcon />
            </span>
            Take photo
          </button>
        )}
      </div>

      <p className="mt-4 text-xs text-ink-subtle">Accepts {acceptedExtensionsLabel()}</p>
    </div>
  )
}
