/**
 * Drop zone for a recorded `session.jsonl`.
 *
 * Offline replay exists for two reasons: comparing a live session against a
 * recorded baseline, and replaying a session this browser never had (a
 * teammate's log, a CI artifact, an upstream snapshot fixture).
 *
 * @module dsh-replay-theater/client/OfflineDrop
 */

import { useCallback, useState } from 'react'
import { parseSessionLog } from '../core/jsonl.ts'
import type { HistoryRecord } from '../core/wire.ts'
import type { Translate } from './dsh.ts'
import styles from './theater.module.css'

/** What a successful load yields. */
export interface OfflineLog {
  readonly name: string
  readonly records: readonly HistoryRecord[]
  /** True when the log carried no timestamps and the cadence is synthetic. */
  readonly synthesizedTimes: boolean
  readonly skipped: number
}

/** Drop-zone props. */
export interface OfflineDropProps {
  readonly t: Translate
  readonly onLoad: (log: OfflineLog) => void
}

/**
 * Render the file drop zone.
 * @param props - translator and load callback.
 * @returns the drop-zone element.
 */
export function OfflineDrop({ t, onLoad }: OfflineDropProps): JSX.Element {
  const [error, setError] = useState<string | undefined>(undefined)

  const ingest = useCallback(async (file: File) => {
    setError(undefined)
    try {
      const text = await file.text()
      const parsed = parseSessionLog(text)
      if (parsed.records.length === 0) {
        setError(t('offline.parseError'))
        return
      }
      onLoad({
        name: file.name,
        records: parsed.records,
        synthesizedTimes: parsed.synthesizedTimes,
        skipped: parsed.skipped.length,
      })
    } catch {
      // A read failure is indistinguishable to the user from a malformed file,
      // and neither is actionable beyond "pick another file".
      setError(t('offline.parseError'))
    }
  }, [onLoad, t])

  return (
    <div
      className={styles.drop}
      data-testid="offline-drop"
      onDragOver={event => event.preventDefault()}
      onDrop={event => {
        event.preventDefault()
        const file = event.dataTransfer?.files?.[0]
        if (file !== undefined) void ingest(file)
      }}
    >
      <p className={styles.dropTitle}>{t('offline.title')}</p>
      <p className={styles.dropHint}>{t('offline.hint')}</p>
      <input
        type="file"
        accept=".jsonl,.json,.log,text/plain"
        data-testid="offline-input"
        onChange={event => {
          const file = event.target.files?.[0]
          if (file !== undefined) void ingest(file)
        }}
      />
      {error !== undefined && (
        <p className={styles.dropError} data-testid="offline-error">{error}</p>
      )}
    </div>
  )
}
