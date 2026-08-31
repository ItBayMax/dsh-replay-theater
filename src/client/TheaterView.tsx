/**
 * The theater tab: stage plus transport bar over one session's history window,
 * with an optional side-by-side comparison against a recorded log.
 *
 * @module dsh-replay-theater/client/TheaterView
 */

import { useCallback, useMemo, useState } from 'react'
import { buildTimeline, DEFAULT_MAX_GAP_MS } from '../core/timeline.ts'
import { CompareView } from './CompareView.tsx'
import type { TheaterInjected, Translate } from './dsh.ts'
import type { OfflineLog } from './OfflineDrop.tsx'
import { OfflineDrop } from './OfflineDrop.tsx'
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
  const [offline, setOffline] = useState<OfflineLog | undefined>(undefined)
  const hasMore = session.eventSource.getSnapshot().hasMore

  const handleLoadOlder = useCallback(() => {
    setLoadingOlder(true)
    // A failed page must not wedge the button; the session owns the error path.
    loadOlder().finally(() => setLoadingOlder(false))
  }, [loadOlder])

  // The compared side is static: it has no player of its own, so it renders at
  // its end state while the live side plays. That keeps one clock in the view.
  const offlineTimeline = useMemo(
    () => (offline === undefined
      ? undefined
      : buildTimeline(offline.records, { maxGapMs: gapCeiling })),
    [offline, gapCeiling],
  )

  return (
    <div className={styles.root} data-testid="theater-root">
      {offlineTimeline === undefined
        ? (
          <TheaterStage
            stage={playback.stage}
            t={t}
            emptyTimeline={playback.timeline.frames.length === 0}
          />
        )
        : (
          <CompareView
            t={t}
            left={{ label: t('compare.left'), timeline: playback.timeline, playback }}
            right={{ label: offline?.name ?? t('compare.right'), timeline: offlineTimeline }}
          />
        )}

      <TheaterControls
        playback={playback}
        t={t}
        gapCeiling={gapCeiling}
        onGapCeilingChange={setGapCeiling}
        onLoadOlder={handleLoadOlder}
        loadingOlder={loadingOlder}
        canLoadOlder={hasMore}
      />

      {offline === undefined
        ? <OfflineDrop t={t} onLoad={setOffline} />
        : (
          <div className={styles.offlineLoaded} data-testid="offline-loaded">
            <span>
              {t('offline.loaded', { count: offline.records.length, name: offline.name })}
              {offline.synthesizedTimes ? ` · ${t('offline.synthetic')}` : ''}
            </span>
            <button
              type="button"
              onClick={() => setOffline(undefined)}
              data-testid="offline-clear"
            >
              {t('offline.clear')}
            </button>
          </div>
        )}
    </div>
  )
}
