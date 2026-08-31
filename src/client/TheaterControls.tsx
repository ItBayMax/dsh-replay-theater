/**
 * The transport bar: play/pause, stepping, speed, scrub, and honest reporting
 * of how much silence playback compressed.
 *
 * @module dsh-replay-theater/client/TheaterControls
 */

import type { Speed } from '../core/player.ts'
import { SPEEDS } from '../core/player.ts'
import { GAP_CHOICES } from './TheaterView.tsx'
import type { Playback } from './usePlayback.ts'
import type { Translate } from './dsh.ts'
import styles from './theater.module.css'

/** Controls props. */
export interface TheaterControlsProps {
  readonly playback: Playback
  readonly t: Translate
  /** Current long-pause ceiling in ms; `Infinity` means true wall-clock cadence. */
  readonly gapCeiling: number
  /** Change the ceiling, which rebuilds the timeline. */
  readonly onGapCeilingChange: (ms: number) => void
  /** Page one older window in; absent when the caller cannot page. */
  readonly onLoadOlder?: () => void
  readonly loadingOlder?: boolean
  readonly canLoadOlder?: boolean
}

/**
 * Format a millisecond position as `m:ss.d`.
 * @param ms - milliseconds.
 * @returns a compact human-readable position.
 */
export function formatPosition(ms: number): string {
  const total = Math.max(0, ms)
  const minutes = Math.floor(total / 60_000)
  const seconds = Math.floor((total % 60_000) / 1000)
  const tenths = Math.floor((total % 1000) / 100)
  return `${minutes}:${String(seconds).padStart(2, '0')}.${tenths}`
}

/**
 * Render the transport bar.
 * @param props - playback handle, translator and paging hooks.
 * @returns the controls element.
 */
export function TheaterControls({
  playback, t, gapCeiling, onGapCeilingChange,
  onLoadOlder, loadingOlder = false, canLoadOlder = false,
}: TheaterControlsProps): JSX.Element {
  const { player, timeline } = playback
  const { positionMs, playing, speed, frameIndex } = player.state
  const disabled = timeline.frames.length === 0

  return (
    <div className={styles.controls} data-testid="theater-controls">
      <div className={styles.buttons}>
        <button
          type="button"
          onClick={playback.toggle}
          disabled={disabled}
          aria-label={playing ? t('control.pause') : t('control.play')}
          data-testid="theater-toggle"
        >
          {playing ? '❚❚' : '▶'}
        </button>
        <button
          type="button"
          onClick={() => playback.stepBy(-1)}
          disabled={disabled}
          aria-label={t('control.stepBack')}
        >
          ⏴
        </button>
        <button
          type="button"
          onClick={() => playback.stepBy(1)}
          disabled={disabled}
          aria-label={t('control.stepForward')}
        >
          ⏵
        </button>
        <button
          type="button"
          onClick={playback.restart}
          disabled={disabled}
          aria-label={t('control.restart')}
        >
          ⤾
        </button>
      </div>

      <input
        type="range"
        className={styles.scrub}
        min={0}
        max={Math.max(1, timeline.totalMs)}
        value={positionMs}
        disabled={disabled}
        aria-label={t('status.position')}
        data-testid="theater-scrub"
        onChange={event => playback.seekTo(Number(event.target.value))}
      />

      <label className={styles.speed}>
        <span className={styles.srOnly}>{t('control.speed')}</span>
        <select
          value={speed}
          disabled={disabled}
          aria-label={t('control.speed')}
          data-testid="theater-speed"
          onChange={event => playback.setSpeed(Number(event.target.value) as Speed)}
        >
          {SPEEDS.map(option => <option key={option} value={option}>{`${option}×`}</option>)}
        </select>
      </label>

      <label className={styles.speed} title={t('settings.maxGapHint')}>
        <span className={styles.srOnly}>{t('settings.maxGap')}</span>
        <select
          value={String(gapCeiling)}
          aria-label={t('settings.maxGap')}
          data-testid="theater-gap"
          onChange={event => onGapCeilingChange(Number(event.target.value))}
        >
          {GAP_CHOICES.map(choice => (
            <option key={String(choice)} value={String(choice)}>
              {choice === Infinity ? '∞' : `${choice}ms`}
            </option>
          ))}
        </select>
      </label>

      <span className={styles.readout} data-testid="theater-readout">
        {`${formatPosition(positionMs)} / ${formatPosition(timeline.totalMs)}`}
        {' · '}
        {t('status.frames', { count: `${frameIndex + 1}/${timeline.frames.length}` })}
      </span>

      {timeline.compressedGaps > 0 && (
        // Never hide that playback altered the data's timing.
        <span className={styles.compressed} data-testid="theater-compressed">
          {t('status.compressed', { ms: Math.round(timeline.compressedMs) })}
        </span>
      )}

      {onLoadOlder !== undefined && canLoadOlder && (
        <button
          type="button"
          className={styles.loadOlder}
          onClick={onLoadOlder}
          disabled={loadingOlder}
          data-testid="theater-load-older"
        >
          {loadingOlder ? t('control.loading') : t('control.loadOlder')}
        </button>
      )}
    </div>
  )
}
