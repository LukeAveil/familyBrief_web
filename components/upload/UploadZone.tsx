'use client'

import { useRef, useState, useSyncExternalStore } from 'react'
import DocIllustration from '@/components/DocIllustration'
import { UploadIcon, CameraIcon } from '@/components/icons'
import {
  buildAcceptAttr,
  isAcceptedType,
  acceptedExtensionsLabel,
  formatBytes,
  MAX_FILE_SIZE_BYTES,
  MAX_FILE_SIZE_LABEL,
} from '@/lib/file-config'

interface UploadZoneProps {
  onFileReady: (file: File) => void
}

// Whether this is a touch device — a browser-only signal read via
// useSyncExternalStore, React's purpose-built API for subscribing to an external
// store. This replaces the old useEffect+setState pattern (which ESLint flags as
// set-state-in-effect): the server snapshot returns false so SSR and the first
// client render agree (no hydration mismatch), the client snapshot then reflects
// the real device, and the `change` subscription keeps it live if the input mode
// changes. Defined at module scope so the function identities are stable across
// renders (a requirement of useSyncExternalStore).
const TOUCH_QUERY = '(hover: none) and (pointer: coarse)'

function subscribeTouch(onChange: () => void): () => void {
  if (typeof window === 'undefined' || !window.matchMedia) return () => {}
  const mql = window.matchMedia(TOUCH_QUERY)
  mql.addEventListener('change', onChange)
  return () => mql.removeEventListener('change', onChange)
}

function getTouchSnapshot(): boolean {
  return (
    typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia(TOUCH_QUERY).matches
  )
}

// Server render has no device to query, so touch is assumed absent — matching
// the client's first render and keeping hydration stable.
function getTouchServerSnapshot(): boolean {
  return false
}

export default function UploadZone({ onFileReady }: UploadZoneProps) {
  const [drag, setDrag] = useState(false)
  // Rejections are shown HERE rather than handed upward, because this is where the
  // file picker is: the parent can pick a different file without going anywhere.
  // Previously an unusable file was dropped on the floor — `handleFile` just
  // returned — so nothing happened at all and there was nothing to act on.
  const [rejection, setRejection] = useState<string | null>(null)
  const isTouchDevice = useSyncExternalStore(
    subscribeTouch,
    getTouchSnapshot,
    getTouchServerSnapshot,
  )
  const fileRef = useRef<HTMLInputElement>(null)
  const cameraRef = useRef<HTMLInputElement>(null)

  const handleFile = (f: File | null | undefined, input?: HTMLInputElement | null) => {
    if (!f) return
    // Always reset the input, including on rejection — otherwise picking the SAME
    // file again fires no change event and the parent appears stuck.
    if (input) input.value = ''

    if (!isAcceptedType(f)) {
      setRejection(`That file type isn’t supported. Try ${acceptedExtensionsLabel()}.`)
      return
    }
    // Check the size BEFORE uploading. The server checks it too, but the request
    // never gets that far: Vercel rejects any body over its own limit at the edge,
    // which is an opaque 413 the route can't turn into a useful message. Catching
    // it here also means we don't push a doomed file over a phone connection.
    if (f.size > MAX_FILE_SIZE_BYTES) {
      setRejection(`That file is ${formatBytes(f.size)} — the limit is ${MAX_FILE_SIZE_LABEL}.`)
      return
    }

    setRejection(null)
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
      onDragOver={(e) => {
        e.preventDefault()
        setDrag(true)
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={handleDrop}
      onClick={() => fileRef.current?.click()}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          fileRef.current?.click()
        }
      }}
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
          onClick={(e) => {
            e.stopPropagation()
            fileRef.current?.click()
          }}
        >
          <span className="w-[18px] h-[18px] flex items-center shrink-0">
            <UploadIcon />
          </span>
          Choose file
        </button>
        {isTouchDevice && (
          <button
            className="btn-secondary-base inline-flex items-center gap-[7px] text-primary px-5 py-[10px] rounded-lg text-[15px] font-medium border-[1.5px] border-line-strong whitespace-nowrap"
            onClick={(e) => {
              e.stopPropagation()
              cameraRef.current?.click()
            }}
          >
            <span className="w-[18px] h-[18px] flex items-center shrink-0">
              <CameraIcon />
            </span>
            Take photo
          </button>
        )}
      </div>

      {/* The size limit gets its own line and a stronger weight than the file-type
          list. It's the constraint a parent is most likely to hit — a phone photo
          or a newsletter with scanned pages runs large — and finding out only
          after picking a file is the frustrating version of this. */}
      <p className="mt-4 text-xs text-ink-subtle">Accepts {acceptedExtensionsLabel()}</p>
      <p className="mt-1 text-xs font-medium text-ink-muted">
        Maximum file size {MAX_FILE_SIZE_LABEL}
      </p>

      {/* role="alert" so a screen reader announces the rejection: the visual cue
          is a line of text appearing under a button the user just pressed, which
          is easy to miss and impossible to hear otherwise. */}
      {rejection && (
        <p role="alert" className="mt-2 text-xs font-medium text-error">
          {rejection}
        </p>
      )}
    </div>
  )
}
