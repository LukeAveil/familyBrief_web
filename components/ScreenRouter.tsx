'use client'

import { useState } from 'react'
import type { CalendarEvent, Screen } from '@/types'
import { MOCK_SINGLE, MOCK_MULTIPLE } from '@/lib/mock-data'
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

const DEV_SCREENS: Array<{ label: string; state: Partial<AppState> }> = [
  { label: 'Upload',      state: { screen: 'upload' } },
  { label: 'Processing',  state: { screen: 'processing', filename: 'Term 3 Newsletter.pdf' } },
  { label: '1 event',     state: { screen: 'results',    filename: 'Sports Day Letter.pdf', events: MOCK_SINGLE } },
  { label: '3 events',    state: { screen: 'results',    filename: 'Summer Newsletter.pdf', events: MOCK_MULTIPLE } },
  { label: 'Error',       state: { screen: 'error',      filename: 'blurry-photo.jpg' } },
]

export default function ScreenRouter() {
  const [app, setApp] = useState<AppState>(DEFAULT_STATE)
  const [transitioning, setTransitioning] = useState(false)

  const navigate = (partial: Partial<AppState>) => {
    setTransitioning(true)
    setTimeout(() => {
      setApp(prev => ({ ...prev, ...partial }))
      setTransitioning(false)
    }, 180)
  }

  return (
    <div className="flex flex-col min-h-screen bg-canvas">
      <NavBar onLogoClick={() => navigate({ screen: 'upload', filename: '', events: [] })} />

      <main className="flex-1 flex flex-col items-center px-4 pt-8 pb-24">
        <div className="w-full max-w-[480px]">
          <div key={app.screen} className={transitioning ? 'screen-exit' : 'screen-enter'}>
            {app.screen === 'upload' && (
              <UploadScreen
                onFileSelect={(name) => navigate({ screen: 'processing', filename: name })}
              />
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
                onRetry={() => navigate({ screen: 'processing' })}
                onReset={() => navigate({ screen: 'upload', filename: '', events: [] })}
              />
            )}
          </div>
        </div>
      </main>

      {/* Dev screen switcher — remove before deploying to users */}
      <nav
        aria-label="Dev screen switcher"
        className="fixed bottom-0 left-0 right-0 flex gap-1 p-2 justify-center bg-white/90 backdrop-blur-sm border-t border-line"
      >
        {DEV_SCREENS.map(({ label, state }) => {
          const active = app.screen === state.screen &&
            (state.screen !== 'results' || app.events.length === (state.events?.length ?? 0))
          return (
            <button
              key={label}
              onClick={() => navigate(state)}
              className={[
                'px-3 py-1.5 text-xs rounded-md font-medium transition-colors',
                active
                  ? 'bg-primary text-white'
                  : 'bg-canvas text-ink-muted hover:bg-primary-light hover:text-primary',
              ].join(' ')}
            >
              {label}
            </button>
          )
        })}
      </nav>
    </div>
  )
}
