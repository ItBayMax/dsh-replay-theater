/**
 * Build a playable timeline from aligned session-history records.
 *
 * This module is the heart of the theater and is deliberately framework-free
 * and dsh-free: given records in, it returns frames out, deterministically.
 * That makes the cadence rules — the part that is easy to get subtly wrong —
 * unit-testable without a browser or a harness checkout.
 *
 * @module dsh-replay-theater/core/timeline
 */

import type { ChunkRowEvent, HistoryRecord, ScalarEvent } from './wire.ts'
import { runMembers } from './wire.ts'

/** What one frame puts on the stage. */
export type FramePayload =
  /** One streamed text token of the assistant's answer. */
  | { readonly kind: 'text'; readonly text: string; readonly block: number }
  /** One streamed token of the assistant's reasoning. */
  | { readonly kind: 'reasoning'; readonly text: string; readonly block: number }
  /** One streamed fragment of a tool call's JSON arguments. */
  | {
    readonly kind: 'tool-args'
    readonly text: string
    readonly block: number
    readonly callId: string
    readonly toolName?: string
  }
  /** A scalar event placed on the timeline as a marker. */
  | { readonly kind: 'marker'; readonly event: ScalarEvent }

/** One thing that happens at one point in playback time. */
export interface Frame {
  /** Milliseconds from the start of playback. Monotonic non-decreasing. */
  readonly atMs: number
  /** The logical session sequence this frame came from. */
  readonly seq: number
  /** Turn number when known (packed runs carry it; scalar markers may not). */
  readonly turn?: number
  /** Step number when known. */
  readonly step?: number
  readonly payload: FramePayload
}

/** A built, playable timeline. */
export interface Timeline {
  readonly frames: readonly Frame[]
  /** Playback duration in milliseconds (0 for an empty or single-frame timeline). */
  readonly totalMs: number
  /** How many raw inter-frame gaps were compressed by `maxGapMs`. */
  readonly compressedGaps: number
  /** Sum of milliseconds removed by compression, for honest UI reporting. */
  readonly compressedMs: number
}

/** Tunables for {@link buildTimeline}. */
export interface TimelineOptions {
  /**
   * Lower bound for any single inter-frame gap, in milliseconds.
   *
   * Measured on a real production session (5,776 events, 54,626 recorded gaps):
   * the MEDIAN gap is 0 ms, because provider chunks routinely arrive within the
   * same millisecond and the log's clock is millisecond-resolution. Replaying
   * those verbatim makes whole paragraphs appear instantly, which defeats the
   * point of a cadence theater. A small floor restores visible typing without
   * inventing structure: the gaps that were genuinely long stay long.
   *
   * Default 0 (verbatim). Set 8-16 ms for a readable typing effect.
   */
  readonly minGapMs?: number

  /**
   * Upper bound for any single inter-frame gap, in milliseconds.
   *
   * Two independent reasons this must exist:
   * 1. A real session's silences (a model thinking for 30 s, a user away for an
   *    hour between turns) would make playback unwatchable.
   * 2. Upstream states a gap may be NEGATIVE when the wall clock stepped
   *    backwards (chunk-rows.ts:36-37), so gaps need clamping anyway.
   *
   * Default 2000 ms. Set `Infinity` for true wall-clock fidelity.
   */
  readonly maxGapMs?: number
}

/** Default long-pause ceiling: long enough to feel like a pause, short enough to watch. */
export const DEFAULT_MAX_GAP_MS = 2000

/** One frame before its playback time is known. */
interface RawFrame {
  readonly absMs: number
  readonly seq: number
  readonly turn?: number
  readonly step?: number
  readonly payload: FramePayload
}

/**
 * Expand one packed delta run into per-member raw frames.
 *
 * The member texts are never joined upstream ("token boundaries are data",
 * chunk-rows.ts:48) and `dt[i]` is the gap between member `i` and `i+1`, so
 * member `k`'s absolute time is `time + sum(dt[0..k-1])`.
 * @param event - one packed chunk-row event.
 * @returns raw frames in log order, one per member.
 */
function expandRun(event: ChunkRowEvent): RawFrame[] {
  const members = runMembers(event)
  const { turn, step, index, dt } = event.data
  const frames: RawFrame[] = []
  let absMs = event.time
  for (let i = 0; i < members.length; i += 1) {
    if (i > 0) {
      // A negative or missing gap contributes nothing; ordering is by log
      // position, never by timestamp.
      absMs += Math.max(0, dt[i - 1] ?? 0)
    }
    const text = members[i] ?? ''
    frames.push({
      absMs,
      seq: event.seq + i,
      turn,
      step,
      payload: event.type === 'chunkrow/tool-call-chunks'
        ? {
          kind: 'tool-args',
          text,
          block: index,
          callId: event.data.id,
          ...event.data.name === undefined ? {} : { toolName: event.data.name },
        }
        : {
          kind: event.type === 'chunkrow/reasoning-chunks' ? 'reasoning' : 'text',
          text,
          block: index,
        },
    })
  }
  return frames
}

/**
 * Turn history records into a playable timeline.
 *
 * Accepts ANY record array rather than reading a live session, so the same
 * function serves the in-app tab, offline files, and side-by-side comparison.
 *
 * Cadence rule: every gap is clamped, whether it came from a run's `dt[]` or
 * from the wall-clock distance between two records. Clamping only `dt` would
 * still let the silence *between* two steps stall playback.
 *
 * @param records - aligned history records, in log order.
 * @param options - cadence tunables.
 * @returns the built timeline; `frames` is empty when nothing is replayable.
 */
export function buildTimeline(
  records: readonly HistoryRecord[],
  options: TimelineOptions = {},
): Timeline {
  const maxGapMs = options.maxGapMs ?? DEFAULT_MAX_GAP_MS
  const minGapMs = Math.max(0, options.minGapMs ?? 0)

  const raw: RawFrame[] = []
  for (const record of records) {
    if (record.type === 'chunks') {
      raw.push(...expandRun(record.event))
      continue
    }
    raw.push({
      absMs: record.event.time,
      seq: record.event.seq,
      payload: { kind: 'marker', event: record.event },
    })
  }

  // Log order is authoritative, but a caller may hand us concatenated windows;
  // sorting by seq keeps the timeline coherent without trusting timestamps.
  raw.sort((left, right) => left.seq - right.seq)

  const frames: Frame[] = []
  let elapsed = 0
  let compressedGaps = 0
  let compressedMs = 0
  for (let i = 0; i < raw.length; i += 1) {
    const current = raw[i]
    if (current === undefined) continue
    if (i > 0) {
      const previous = raw[i - 1]
      const rawGap = Math.max(0, current.absMs - (previous?.absMs ?? current.absMs))
      // Floor first, then ceiling: a floor above the ceiling would otherwise
      // stretch a compressed gap back out.
      const floored = Math.max(rawGap, minGapMs)
      const gap = Math.min(floored, maxGapMs)
      if (gap < rawGap) {
        compressedGaps += 1
        compressedMs += rawGap - gap
      }
      elapsed += gap
    }
    frames.push({
      atMs: elapsed,
      seq: current.seq,
      ...current.turn === undefined ? {} : { turn: current.turn },
      ...current.step === undefined ? {} : { step: current.step },
      payload: current.payload,
    })
  }

  return {
    frames,
    totalMs: frames.length === 0 ? 0 : (frames[frames.length - 1]?.atMs ?? 0),
    compressedGaps,
    compressedMs,
  }
}

/**
 * Find the index of the last frame at or before a playback position.
 *
 * Binary search over the monotonic `atMs` sequence, so seeking a long timeline
 * costs log(n) rather than a scan.
 * @param timeline - a built timeline.
 * @param atMs - playback position in milliseconds.
 * @returns the frame index, or -1 when the position precedes every frame.
 */
export function frameIndexAt(timeline: Timeline, atMs: number): number {
  const { frames } = timeline
  let low = 0
  let high = frames.length - 1
  let found = -1
  while (low <= high) {
    const mid = (low + high) >> 1
    const frame = frames[mid]
    if (frame === undefined) break
    if (frame.atMs <= atMs) {
      found = mid
      low = mid + 1
    } else {
      high = mid - 1
    }
  }
  return found
}

/** One accumulated block of streamed output, ready to render. */
export interface StageBlock {
  readonly kind: 'text' | 'reasoning' | 'tool-args'
  readonly block: number
  readonly turn?: number
  readonly step?: number
  readonly callId?: string
  readonly toolName?: string
  readonly text: string
}

/** What the stage shows at one playback position. */
export interface StageState {
  readonly blocks: readonly StageBlock[]
  readonly markers: readonly ScalarEvent[]
}

/**
 * Accumulate frames up to and including `throughIndex` into renderable blocks.
 *
 * Consecutive frames of the same kind, block index, turn and step concatenate
 * into one block — that is how a stream of tokens becomes a paragraph — while a
 * change in any of those starts a new block.
 * @param timeline - a built timeline.
 * @param throughIndex - inclusive last frame index; -1 yields the empty stage.
 * @returns the accumulated stage state.
 */
export function stageAt(timeline: Timeline, throughIndex: number): StageState {
  const blocks: StageBlock[] = []
  const markers: ScalarEvent[] = []
  const last = Math.min(throughIndex, timeline.frames.length - 1)
  for (let i = 0; i <= last; i += 1) {
    const frame = timeline.frames[i]
    if (frame === undefined) continue
    const { payload } = frame
    if (payload.kind === 'marker') {
      markers.push(payload.event)
      continue
    }
    const open = blocks[blocks.length - 1]
    const sameBlock = open !== undefined
      && open.kind === payload.kind
      && open.block === payload.block
      && open.turn === frame.turn
      && open.step === frame.step
      && open.callId === (payload.kind === 'tool-args' ? payload.callId : undefined)
    if (sameBlock && open !== undefined) {
      blocks[blocks.length - 1] = { ...open, text: open.text + payload.text }
      continue
    }
    blocks.push({
      kind: payload.kind,
      block: payload.block,
      ...frame.turn === undefined ? {} : { turn: frame.turn },
      ...frame.step === undefined ? {} : { step: frame.step },
      ...payload.kind === 'tool-args' ? { callId: payload.callId } : {},
      ...payload.kind === 'tool-args' && payload.toolName !== undefined
        ? { toolName: payload.toolName }
        : {},
      text: payload.text,
    })
  }
  return { blocks, markers }
}
