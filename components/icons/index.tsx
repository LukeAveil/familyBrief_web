const strokeProps = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
}

export function CalendarIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-full h-full" {...strokeProps}>
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  )
}

export function ClockIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-full h-full" {...strokeProps}>
      <circle cx="12" cy="12" r="10" />
      <polyline points="12,6 12,12 16,14" />
    </svg>
  )
}

export function PinIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-full h-full" {...strokeProps}>
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  )
}

export function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-full h-full" {...strokeProps}>
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <polyline points="22,4 12,14.01 9,11.01" />
    </svg>
  )
}

export function UploadIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-full h-full" {...strokeProps}>
      <polyline points="16,16 12,12 8,16" />
      <line x1="12" y1="12" x2="12" y2="21" />
      <path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3" />
    </svg>
  )
}

export function CameraIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-full h-full" {...strokeProps}>
      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
      <circle cx="12" cy="13" r="4" />
    </svg>
  )
}

export function AlertIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-full h-full" {...strokeProps}>
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  )
}

export function InfoIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-full h-full" {...strokeProps}>
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  )
}

export function RefreshIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-full h-full" {...strokeProps}>
      <polyline points="1,4 1,10 7,10" />
      <path d="M3.51 15a9 9 0 1 0 .49-3.5" />
    </svg>
  )
}

export function GoogleIcon() {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
      <path d="M19.6 10.23c0-.68-.06-1.36-.17-2H10v3.79h5.38a4.61 4.61 0 0 1-2 3.03v2.5h3.24c1.9-1.74 3-4.3 3-7.32z" fill="#4285F4" />
      <path d="M10 20c2.7 0 4.97-.89 6.62-2.42l-3.24-2.5c-.9.6-2.04.96-3.38.96-2.6 0-4.8-1.76-5.59-4.12H1.07v2.58A9.97 9.97 0 0 0 10 20z" fill="#34A853" />
      <path d="M4.41 11.92A5.97 5.97 0 0 1 4.1 10c0-.67.11-1.31.31-1.92V5.5H1.07A9.97 9.97 0 0 0 0 10c0 1.62.39 3.15 1.07 4.5l3.34-2.58z" fill="#FBBC04" />
      <path d="M10 3.96c1.47 0 2.79.5 3.83 1.5l2.87-2.87C14.96.9 12.7 0 10 0A9.97 9.97 0 0 0 1.07 5.5l3.34 2.58C5.2 5.72 7.4 3.96 10 3.96z" fill="#EA4335" />
    </svg>
  )
}
