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

/** Props the slot runtime composes for this view. */
export type TheaterViewProps = TheaterInjected & {
  /** Translator for this plugin's namespace, supplied by the slot runtime. */
  readonly t: Translate
  /** Long-pause ceiling; the view keeps it in state so P3 can expose a control. */
  readonly maxGapMs?: number
}

/**
 * Render the theater.
 * @param props - injected session face, translator and cadence tunable.
 * @returns the theater element.
 */
export function TheaterView({ session, loadOlder, t, maxGapMs }: TheaterViewProps): JSX.Element {
  const playback = usePlayback(session, { maxGapMs: maxGapMs ?? DEFAULT_MAX_GAP_MS })
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
        onLoadOlder={handleLoadOlder}
        loadingOlder={loadingOlder}
        canLoadOlder={hasMore}
      />
    </div>
  )
}
