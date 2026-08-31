/**
 * Side-by-side replay of two timelines, with the first divergence named.
 *
 * This is the piece that turns the theater into an evaluation surface: two runs
 * of the same task replay together, and one click jumps both playheads to the
 * exact frame where their output stopped matching.
 *
 * @module dsh-replay-theater/client/CompareView
 */

import { useCallback, useMemo } from 'react'
import type { Divergence } from '../core/compare.ts'
import { findDivergence, summarize } from '../core/compare.ts'
import type { Timeline } from '../core/timeline.ts'
import { stageAt } from '../core/timeline.ts'
import type { Translate } from './dsh.ts'
import type { Playback } from './usePlayback.ts'
import { TheaterStage } from './TheaterStage.tsx'
import styles from './theater.module.css'

/** One side of a comparison. */
export interface CompareSide {
  readonly label: string
  readonly timeline: Timeline
  /** Live playback when this side is driven by a player; absent for static sides. */
  readonly playback?: Playback
  /** Frame index to show when there is no playback. */
  readonly frameIndex?: number
}

/** Comparison props. */
export interface CompareViewProps {
  readonly left: CompareSide
  readonly right: CompareSide
  readonly t: Translate
}

/**
 * One-line explanation of a divergence.
 * @param divergence - the computed divergence.
 * @param t - translator.
 * @returns the human-readable line.
 */
export function describeDivergence(divergence: Divergence, t: Translate): string {
  if (divergence.kind === 'identical') return t('compare.identical')
  const seq = divergence.leftSeq ?? divergence.rightSeq ?? divergence.atFrame
  return t('compare.divergeAt', { seq })
}

/**
 * Render two timelines side by side.
 * @param props - both sides and a translator.
 * @returns the comparison element.
 */
export function CompareView({ left, right, t }: CompareViewProps): JSX.Element {
  const divergence = useMemo(
    () => findDivergence(left.timeline, right.timeline),
    [left.timeline, right.timeline],
  )
  const leftSummary = useMemo(() => summarize(left.timeline), [left.timeline])
  const rightSummary = useMemo(() => summarize(right.timeline), [right.timeline])

  const jumpToDivergence = useCallback(() => {
    if (divergence.kind !== 'diverged') return
    if (divergence.leftAtMs !== undefined) left.playback?.seekTo(divergence.leftAtMs)
    if (divergence.rightAtMs !== undefined) right.playback?.seekTo(divergence.rightAtMs)
  }, [divergence, left.playback, right.playback])

  const sideFrame = (side: CompareSide): number =>
    side.playback?.player.state.frameIndex ?? side.frameIndex ?? side.timeline.frames.length - 1

  return (
    <div className={styles.compare} data-testid="compare-root">
      <header className={styles.compareHeader}>
        <span data-testid="compare-divergence">{describeDivergence(divergence, t)}</span>
        {divergence.kind === 'diverged'
          && (left.playback !== undefined || right.playback !== undefined) && (
          <button
            type="button"
            onClick={jumpToDivergence}
            data-testid="compare-jump"
          >
            {t('compare.divergeAt', { seq: divergence.leftSeq ?? divergence.rightSeq ?? '?' })}
          </button>
        )}
      </header>

      <div className={styles.compareBody}>
        {[
          { side: left, summary: leftSummary, testId: 'compare-left' },
          { side: right, summary: rightSummary, testId: 'compare-right' },
        ].map(({ side, summary, testId }) => (
          <section key={testId} className={styles.comparePane} data-testid={testId}>
            <h3 className={styles.compareLabel}>{side.label}</h3>
            <p className={styles.compareStats}>
              {t('status.frames', { count: summary.frames })}
              {summary.tools.length > 0 ? ` · ${summary.tools.join(', ')}` : ''}
            </p>
            <TheaterStage
              stage={stageAt(side.timeline, sideFrame(side))}
              t={t}
              emptyTimeline={side.timeline.frames.length === 0}
            />
          </section>
        ))}
      </div>
    </div>
  )
}
