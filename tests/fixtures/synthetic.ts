/**
 * Hand-built history records with exact `dt` arrays.
 *
 * The upstream snapshot corpus cannot carry cadence assertions: it is recorded
 * against replayed model responses, so the longest consecutive same-block delta
 * run in the ENTIRE corpus is 2 members (measured across all 118 session.jsonl
 * files), and normalization strips `seq`/`time` anyway. So cadence is tested
 * with these fixtures, and real-shape compatibility with the derived corpus
 * fixture in `corpus-escalation-approved.json`.
 *
 * @module dsh-replay-theater/tests/fixtures/synthetic
 */

import type { HistoryRecord } from '../../src/core/wire.ts'

/** Base epoch for readable expected values. */
export const T0 = 1_760_000_000_000

/**
 * Build one packed text run.
 * @param options - run coordinates, members and gaps.
 * @returns one `chunks` record.
 */
export function textRun(options: {
  seq: number
  time: number
  texts: readonly string[]
  dt: readonly number[]
  turn?: number
  step?: number
  block?: number
}): HistoryRecord {
  return {
    type: 'chunks',
    event: {
      type: 'chunkrow/text-chunks',
      seq: options.seq,
      time: options.time,
      data: {
        turn: options.turn ?? 1,
        step: options.step ?? 1,
        index: options.block ?? 0,
        dt: options.dt,
        texts: options.texts,
      },
    },
  }
}

/**
 * Build one packed reasoning run.
 * @param options - run coordinates, members and gaps.
 * @returns one `chunks` record.
 */
export function reasoningRun(options: {
  seq: number
  time: number
  texts: readonly string[]
  dt: readonly number[]
  turn?: number
  step?: number
  block?: number
}): HistoryRecord {
  return {
    type: 'chunks',
    event: {
      type: 'chunkrow/reasoning-chunks',
      seq: options.seq,
      time: options.time,
      data: {
        turn: options.turn ?? 1,
        step: options.step ?? 1,
        index: options.block ?? 0,
        dt: options.dt,
        texts: options.texts,
      },
    },
  }
}

/**
 * Build one packed tool-argument run.
 * @param options - run coordinates, members, gaps and call identity.
 * @returns one `chunks` record.
 */
export function toolRun(options: {
  seq: number
  time: number
  args: readonly string[]
  dt: readonly number[]
  id: string
  name?: string
  turn?: number
  step?: number
  block?: number
}): HistoryRecord {
  return {
    type: 'chunks',
    event: {
      type: 'chunkrow/tool-call-chunks',
      seq: options.seq,
      time: options.time,
      data: {
        turn: options.turn ?? 1,
        step: options.step ?? 1,
        index: options.block ?? 0,
        dt: options.dt,
        id: options.id,
        ...options.name === undefined ? {} : { name: options.name },
        args: options.args,
      },
    },
  }
}

/**
 * Build one scalar event record.
 * @param options - event type, sequence and time.
 * @returns one `event` record.
 */
export function scalar(options: { type: string; seq: number; time: number }): HistoryRecord {
  return {
    type: 'event',
    event: { type: options.type, seq: options.seq, time: options.time },
  }
}
