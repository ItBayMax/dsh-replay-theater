/**
 * Minimal structural mirror of the DeepSeek Harness session-history wire shapes
 * this plugin reads. Nothing here is imported from `@deepseek-ai/*` on purpose:
 * the core replay logic must stay testable without a harness checkout, and
 * `@deepseek-ai/dsh-api-session-controller` is not published to npm at all
 * (verified 2026-08-31 — only `dsh-session@0.0.1-rc.1` and a few client
 * packages are, none of them the controller).
 *
 * These are TYPES ONLY and are structurally compatible with the upstream
 * declarations, so a future version can swap them for real `import type`s
 * without touching call sites. Each mirror records the upstream location it was
 * read from, pinned to commit 0a53fb5 (dsh@0.1.2-alpha.2).
 *
 * @module dsh-replay-theater/core/wire
 */

/**
 * One packed run of consecutive assistant delta events.
 *
 * Mirrors `ChunkRowEvent` — packages/api/session-controller/src/types.ts:388.
 * The inner `data` mirrors `ChunkRow['data']` —
 * packages/core/session/src/chunk-rows.ts:39-62.
 */
export type ChunkRowEvent =
  | {
    readonly type: 'chunkrow/text-chunks'
    readonly seq: number
    readonly time: number
    readonly data: TextRunData
  }
  | {
    readonly type: 'chunkrow/reasoning-chunks'
    readonly seq: number
    readonly time: number
    readonly data: TextRunData
  }
  | {
    readonly type: 'chunkrow/tool-call-chunks'
    readonly seq: number
    readonly time: number
    readonly data: ToolCallRunData
  }

/** Fields every packed run shares. Mirrors `RunDataBase` — chunk-rows.ts:39-46. */
export interface RunDataBase {
  readonly turn: number
  readonly step: number
  /** The stream block index every member shares. */
  readonly index: number
  /**
   * Epoch-ms gaps between consecutive members; length is one less than the
   * member count. A gap may be NEGATIVE when the wall clock stepped backwards
   * (chunk-rows.ts:36-37) — every consumer must clamp.
   */
  readonly dt: readonly number[]
}

/**
 * Text or reasoning run payload. One entry per member, never joined — upstream
 * states the reason at chunk-rows.ts:48: "token boundaries are data".
 */
export interface TextRunData extends RunDataBase {
  readonly texts: readonly string[]
}

/** Tool-call argument run payload. Mirrors `ToolCallRunData` — chunk-rows.ts:52-62. */
export interface ToolCallRunData extends RunDataBase {
  readonly id: string
  readonly name?: string
  readonly args: readonly string[]
}

/**
 * One scalar session event, kept opaque on purpose: the theater only needs its
 * `type`/`seq`/`time` to place a marker on the timeline, and narrowing the full
 * `SessionEventMap` union would couple this package to the upstream vocabulary.
 *
 * Mirrors the envelope of `SessionEvent` — packages/core/session/src/types.ts.
 */
export interface ScalarEvent {
  readonly type: string
  readonly seq: number
  readonly time: number
  readonly [extra: string]: unknown
}

/**
 * One aligned history record as it reaches the browser.
 *
 * Mirrors `SessionHistoryRecord` — packages/api/session-controller/src/types.ts:404.
 * The OUTER `type` is the only safe discriminator: upstream's own
 * `historyEntries()` is an unchecked cast (client/sessions/history-records.ts:15).
 */
export type HistoryRecord =
  | { readonly type: 'event'; readonly event: ScalarEvent }
  | { readonly type: 'chunks'; readonly event: ChunkRowEvent }

/**
 * Read the inclusive last logical sequence a record represents.
 *
 * Ported from upstream `historyRecordLastSeq()` —
 * packages/api/session-controller/src/client/sessions/history-records.ts:33.
 * @param record - one scalar event or packed delta run.
 * @returns the inclusive final session sequence.
 */
export function recordLastSeq(record: HistoryRecord): number {
  if (record.type === 'event') return record.event.seq
  const length = record.event.type === 'chunkrow/tool-call-chunks'
    ? record.event.data.args.length
    : record.event.data.texts.length
  return record.event.seq + length - 1
}

/**
 * Read the member texts of a packed run, whichever payload shape it carries.
 * @param event - one packed chunk-row event.
 * @returns the per-member strings in log order.
 */
export function runMembers(event: ChunkRowEvent): readonly string[] {
  return event.type === 'chunkrow/tool-call-chunks' ? event.data.args : event.data.texts
}
