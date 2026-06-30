'use client'

import { useRef, useState } from 'react'
import type { CalendarEvent, Screen } from '@/types'
import NavBar from '@/components/NavBar'
import UploadScreen from '@/components/upload/UploadScreen'
import ProcessingScreen from '@/components/processing/ProcessingScreen'
import ResultsScreen from '@/components/results/ResultsScreen'
import ErrorScreen from '@/components/error/ErrorScreen'

interface AppState {
  screen: Screen
  filename: string
  events: CalendarEvent[]
}

const DEFAULT_STATE: AppState = {
  screen: 'upload',
  filename: '',
  events: [],
}

export default function ScreenRouter() {
  const [app, setApp] = useState<AppState>(DEFAULT_STATE)
  const [transitioning, setTransitioning] = useState(false)
  const lastFile = useRef<File | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const navigate = (partial: Partial<AppState>) => {
    setTransitioning(true)
    setTimeout(() => {
      setApp(prev => ({ ...prev, ...partial }))
      setTransitioning(false)
    }, 180)
  }

  const handleFileReady = async (file: File) => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    lastFile.current = file
    navigate({ screen: 'processing', filename: file.name })

    const formData = new FormData()
    formData.append('file', file)

    try {
      const res = await fetch('/api/upload', { method: 'POST', body: formData, signal: controller.signal })
      const data = await res.json()
      if (data.ok) {
        navigate({ screen: 'results', filename: file.name, events: data.events })
      } else {
        navigate({ screen: 'error', filename: file.name })
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return
      navigate({ screen: 'error', filename: file.name })
    } finally {
      abortRef.current = null
    }
  }

  return (
    <div className="flex flex-col min-h-screen bg-canvas">
      <NavBar onLogoClick={() => navigate({ screen: 'upload', filename: '', events: [] })} />

      <main className="flex-1 flex flex-col items-center px-4 pt-8 pb-8">
        <div className="w-full max-w-[480px]">
          <div key={app.screen} className={transitioning ? 'screen-exit' : 'screen-enter'}>
            {app.screen === 'upload' && (
              <UploadScreen onFileReady={handleFileReady} />
            )}
            {app.screen === 'processing' && (
              <ProcessingScreen filename={app.filename} />
            )}
            {app.screen === 'results' && (
              <ResultsScreen
                filename={app.filename}
                events={app.events}
                onReset={() => navigate({ screen: 'upload', filename: '', events: [] })}
              />
            )}
            {app.screen === 'error' && (
              <ErrorScreen
                filename={app.filename}
                onRetry={() => lastFile.current && handleFileReady(lastFile.current)}
                onReset={() => navigate({ screen: 'upload', filename: '', events: [] })}
              />
            )}
          </div>
        </div>
      </main>

    </div>
  )
}
