/**
 * Hand-built history records with exact `dt` arrays.
 *
 * The upstream snapshot corpus covers the SHAPE well but cannot carry cadence
 * assertions. Measured on 639ed01 across its 173 `session.v3.jsonl` files: all
 * 526 packed runs keep their `time0` and `dt`, and the longest run holds 2047
 * members — but 373 of those runs have an all-zero `dt`, the largest gap
 * anywhere is 156 ms, and normalization strips row-level `seq`/`time` from all
 * 4343 rows. Those sessions were recorded against fast or stubbed models, so
 * there is no real "model pauses to think" cadence in them. Cadence is
 * therefore tested with these fixtures.
 *
 * Since session format v2 a settled attempt is ONE event carrying its packed
 * runs in `data.stream`. The single-run builders below therefore each produce a
 * one-member attempt, which keeps every existing cadence assertion meaningful;
 * {@link assistantEvent} builds the multi-run case, and {@link transient} the
 * client-only provisional frame the theater must ignore.
 *
 * @module dsh-replay-theater/tests/fixtures/synthetic
 */

import type { AssistantStreamRecord, HistoryRecord } from '../../src/core/wire.ts'

/** Base epoch for readable expected values. */
export const T0 = 1_760_000_000_000

/**
 * Wrap packed runs into one settled assistant event.
 * @param options - event coordinates and its stream members.
 * @returns one durable `event` record.
 */
export function assistantEvent(options: {
  seq: number
  time: number
  stream: readonly AssistantStreamRecord[]
  turn?: number
  step?: number
  /** Defaults to `assistant/message`; pass `assistant/attempt` for the unsettled-surface case. */
  type?: 'assistant/message' | 'assistant/attempt'
}): HistoryRecord {
  return {
    type: 'event',
    event: {
      type: options.type ?? 'assistant/message',
      seq: options.seq,
      time: options.time,
      data: {
        turn: options.turn ?? 1,
        step: options.step ?? 1,
        stream: options.stream,
      },
    },
  }
}

/**
 * Build one packed text run as its own settled attempt.
 * @param options - run coordinates, members and gaps.
 * @returns one durable `event` record.
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
  return assistantEvent({
    seq: options.seq,
    time: options.time,
    ...options.turn === undefined ? {} : { turn: options.turn },
    ...options.step === undefined ? {} : { step: options.step },
    stream: [{
      type: 'text-chunks',
      time0: options.time,
      index: options.block ?? 0,
      dt: options.dt,
      texts: options.texts,
    }],
  })
}

/**
 * Build one packed reasoning run as its own settled attempt.
 * @param options - run coordinates, members and gaps.
 * @returns one durable `event` record.
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
  return assistantEvent({
    seq: options.seq,
    time: options.time,
    ...options.turn === undefined ? {} : { turn: options.turn },
    ...options.step === undefined ? {} : { step: options.step },
    stream: [{
      type: 'reasoning-chunks',
      time0: options.time,
      index: options.block ?? 0,
      dt: options.dt,
      texts: options.texts,
    }],
  })
}

/**
 * Build one packed tool-argument run as its own settled attempt.
 * @param options - run coordinates, members, gaps and call identity.
 * @returns one durable `event` record.
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
  return assistantEvent({
    seq: options.seq,
    time: options.time,
    ...options.turn === undefined ? {} : { turn: options.turn },
    ...options.step === undefined ? {} : { step: options.step },
    stream: [{
      type: 'tool-call-chunks',
      time0: options.time,
      index: options.block ?? 0,
      dt: options.dt,
      id: options.id,
      ...options.name === undefined ? {} : { name: options.name },
      args: options.args,
    }],
  })
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

/**
 * Build one client-only provisional assistant frame.
 *
 * Upstream replaces these atomically with a settled event, so the theater must
 * ignore them or every token would play twice.
 * @param options - frame coordinates.
 * @returns one `transient` record.
 */
export function transient(options: { seq: number; time: number; text?: string }): HistoryRecord {
  return {
    type: 'transient',
    event: {
      type: 'assistant/chunk',
      seq: options.seq,
      time: options.time,
      data: { chunk: { kind: 'text', text: options.text ?? 'live' } },
    },
  }
}
