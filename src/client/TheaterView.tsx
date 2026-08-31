/**
 * The theater tab: stage plus transport bar over one session's history window.
 *
 * @module dsh-replay-theater/client/TheaterView
 */

import { useCallback, useState } from 'react'
import { DEFAULT_MAX_GAP_MS } from '../core/timeline.ts'
import type { TheaterInjected, Translate } from './dsh.ts'
import { TheaterControls } from './TheaterControls.tsx'
import { TheaterStage } from './TheaterStage.tsx'
import { usePlayback } from './usePlayback.ts'
import styles from './theater.module.css'

/** Selectable long-pause ceilings, in milliseconds. `Infinity` keeps real cadence. */
export const GAP_CHOICES = [200, 500, 2000, 5000, Infinity] as const

/** Props the slot runtime composes for this view. */
export type TheaterViewProps = TheaterInjected & {
  /** Translator for this plugin's namespace, supplied by the slot runtime. */
  readonly t: Translate
  /** Initial long-pause ceiling; the user can change it from the transport bar. */
  readonly maxGapMs?: number
}

/**
 * Render the theater.
 * @param props - injected session face, translator and initial cadence tunable.
 * @returns the theater element.
 */
export function TheaterView({ session, loadOlder, t, maxGapMs }: TheaterViewProps): JSX.Element {
  const [gapCeiling, setGapCeiling] = useState<number>(maxGapMs ?? DEFAULT_MAX_GAP_MS)
  const playback = usePlayback(session, { maxGapMs: gapCeiling })
  const [loadingOlder, setLoadingOlder] = useState(false)
  const hasMore = session.eventSource.getSnapshot().hasMore

  const handleLoadOlder = useCallback(() => {
    setLoadingOlder(true)
    // A failed page must not wedge the button; the session owns the error path.
    loadOlder().finally(() => setLoadingOlder(false))
  }, [loadOlder])

  return (
    <div className={styles.root} data-testid="theater-root">
      <TheaterStage
        stage={playback.stage}
        t={t}
        emptyTimeline={playback.timeline.frames.length === 0}
      />
      <TheaterControls
        playback={playback}
        t={t}
        gapCeiling={gapCeiling}
        onGapCeilingChange={setGapCeiling}
        onLoadOlder={handleLoadOlder}
        loadingOlder={loadingOlder}
        canLoadOlder={hasMore}
      />
    </div>
  )
}
