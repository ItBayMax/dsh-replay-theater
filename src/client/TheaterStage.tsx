/**
 * The stage: streamed output as it stood at the playhead.
 *
 * @module dsh-replay-theater/client/TheaterStage
 */

import type { StageState } from '../core/timeline.ts'
import type { Translate } from './dsh.ts'
import styles from './theater.module.css'

/** Stage props. */
export interface TheaterStageProps {
  readonly stage: StageState
  readonly t: Translate
  /** True when the timeline itself is empty (nothing replayable in the window). */
  readonly emptyTimeline: boolean
}

/**
 * Render the accumulated blocks.
 * @param props - stage state and translator.
 * @returns the stage element.
 */
export function TheaterStage({ stage, t, emptyTimeline }: TheaterStageProps): JSX.Element {
  if (emptyTimeline) {
    return (
      <div className={styles.empty}>
        <p className={styles.emptyTitle}>{t('stage.empty')}</p>
        <p className={styles.emptyHint}>{t('stage.emptyHint')}</p>
      </div>
    )
  }

  return (
    <div className={styles.stage} data-testid="theater-stage">
      {stage.blocks.map((block, index) => (
        <section
          // Block identity is (kind, block, turn, step, callId); the index is a
          // stable tiebreak because blocks are append-only during playback.
          key={`${block.kind}-${block.turn ?? 0}-${block.step ?? 0}-${block.block}-${block.callId ?? ''}-${index}`}
          className={
            block.kind === 'reasoning' ? styles.reasoning
              : block.kind === 'tool-args' ? styles.toolArgs
                : styles.text
          }
        >
          {block.kind !== 'text' && (
            <header className={styles.blockLabel}>
              {block.kind === 'reasoning' ? t('stage.reasoning') : t('stage.toolCall')}
              {block.toolName === undefined ? '' : ` · ${block.toolName}`}
            </header>
          )}
          <pre className={styles.blockBody}>{block.text}</pre>
        </section>
      ))}
      {stage.markers.length > 0 && (
        <footer className={styles.markers} data-testid="theater-markers">
          {stage.markers.map((marker, index) => (
            <span key={`${marker.seq}-${index}`} className={styles.marker}>{marker.type}</span>
          ))}
        </footer>
      )}
    </div>
  )
}
