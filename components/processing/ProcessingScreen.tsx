'use client'

/**
 * ProcessingScreen — the "reading your letter" view.
 *
 * Purely presentational and prop-driven: it just renders whatever summary text
 * ScreenRouter has accumulated so far. There is no timer or fake progress — the
 * text growing IS the progress, straight from the model stream. Events are never
 * shown here; they arrive only on the terminal `done` frame and render on the
 * results screen, so nothing actionable appears while the stream is mid-flight.
 */

interface ProcessingScreenProps {
  filename: string
  /** Summary text as it streams in from the server (empty until the first token). */
  summary: string
}

export default function ProcessingScreen({ filename, summary }: ProcessingScreenProps) {
  // Before any tokens arrive, show a gentle placeholder so there's no empty flash;
  // once text starts streaming we render it live with a blinking caret.
  const streaming = summary.length > 0

  return (
    <div className="flex flex-col items-center">
      <div className="bg-surface border border-line rounded-[28px] px-7 py-9 text-center shadow-md w-full">

        {/* Animated document illustration */}
        <div className="flex justify-center mb-7">
          <div className="proc-doc w-[68px] h-[86px] bg-surface rounded-[6px] border-[1.5px] border-line shadow-md relative overflow-hidden">
            <div className="scan-beam" />
            <div className="p-[10px_8px] flex flex-col gap-[6px]">
              {[100, 80, 55, 90, 70, 65].map((w, i) => (
                <div
                  key={i}
                  className="h-[2.5px] bg-line rounded-sm"
                  style={{ width: `${w}%` }}
                />
              ))}
            </div>
          </div>
        </div>

        <h2 className="text-[20px] font-bold tracking-[-0.3px] text-ink mb-1">
          Reading your letter
        </h2>
        <p className="text-[13px] text-ink-subtle mb-5 overflow-hidden text-ellipsis whitespace-nowrap">
          {filename}
        </p>

        {/* Live summary — types out token by token as the server streams it. The
            events themselves are held back until extraction completes, so nothing
            actionable is shown here. */}
        <p className="text-[14px] leading-relaxed text-ink text-left min-h-[3.5em] whitespace-pre-wrap">
          {streaming ? (
            <>
              {summary}
              <span className="proc-caret" aria-hidden>▋</span>
            </>
          ) : (
            <span className="text-ink-subtle">Scanning your document…</span>
          )}
        </p>

      </div>
    </div>
  )
}
