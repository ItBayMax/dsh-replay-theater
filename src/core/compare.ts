/**
 * Compare two timelines: where they agree, where they first diverge.
 *
 * This is the piece that makes the theater useful beyond watching one session:
 * two runs of the same task — different model, different preset, different
 * provider — replay side by side, and the comparison names the exact point
 * where their output stopped matching.
 *
 * It works on built timelines rather than on sessions, so the same function
 * serves live windows, offline files, and any future evaluation report.
 *
 * @module dsh-replay-theater/core/compare
 */

import type { Timeline } from './timeline.ts'
import { stageAt } from './timeline.ts'

/** How two timelines relate. */
export type Divergence =
  /** The compared prefixes are identical for their whole shared length. */
  | {
    readonly kind: 'identical'
    /** How many frames were compared. */
    readonly comparedFrames: number
    /** True when one side simply has more frames after the shared prefix. */
    readonly lengthDiffers: boolean
  }
  /** The sides differ, first at this frame index. */
  | {
    readonly kind: 'diverged'
    /** Frame index (same on both sides) where the first difference appears. */
    readonly atFrame: number
    /** Sequence numbers at that frame, when the frame exists on that side. */
    readonly leftSeq?: number
    readonly rightSeq?: number
    /** Playback positions of that frame, for seeking both players there. */
    readonly leftAtMs?: number
    readonly rightAtMs?: number
    /** What differed, for a one-line explanation. */
    readonly reason: 'payload-kind' | 'text' | 'marker-type' | 'left-ended' | 'right-ended'
  }

/**
 * Comparable identity of one frame's payload.
 *
 * Deliberately excludes timing and sequence: two runs of the same task produce
 * different wall clocks and different sequence numbering, so comparing those
 * would report divergence on every pair. What matters is what the model
 * produced, in order.
 * @param timeline - the timeline holding the frame.
 * @param index - frame index.
 * @returns a comparable descriptor, or undefined past the end.
 */
function payloadKey(timeline: Timeline, index: number): {
  kind: string
  text: string
} | undefined {
  const frame = timeline.frames[index]
  if (frame === undefined) return undefined
  const { payload } = frame
  return payload.kind === 'marker'
    ? { kind: 'marker', text: payload.event.type }
    : { kind: payload.kind, text: payload.text }
}

/**
 * Find the first frame where two timelines stop matching.
 *
 * @param left - one timeline.
 * @param right - the other timeline.
 * @returns the divergence description.
 */
export function findDivergence(left: Timeline, right: Timeline): Divergence {
  const shared = Math.min(left.frames.length, right.frames.length)
  for (let index = 0; index < shared; index += 1) {
    const leftKey = payloadKey(left, index)
    const rightKey = payloadKey(right, index)
    if (leftKey === undefined || rightKey === undefined) break
    if (leftKey.kind !== rightKey.kind) {
      return {
        kind: 'diverged',
        atFrame: index,
        ...frameCoordinates(left, right, index),
        reason: leftKey.kind === 'marker' || rightKey.kind === 'marker'
          ? 'marker-type'
          : 'payload-kind',
      }
    }
    if (leftKey.text !== rightKey.text) {
      return {
        kind: 'diverged',
        atFrame: index,
        ...frameCoordinates(left, right, index),
        reason: leftKey.kind === 'marker' ? 'marker-type' : 'text',
      }
    }
  }

  if (left.frames.length !== right.frames.length) {
    // The shared prefix matched; one side kept going.
    const atFrame = shared
    return {
      kind: 'diverged',
      atFrame,
      ...frameCoordinates(left, right, atFrame),
      reason: left.frames.length < right.frames.length ? 'left-ended' : 'right-ended',
    }
  }

  return { kind: 'identical', comparedFrames: shared, lengthDiffers: false }
}

/**
 * Collect the seek coordinates of one frame index on both sides.
 * @param left - one timeline.
 * @param right - the other timeline.
 * @param index - frame index.
 * @returns the optional per-side sequence and position fields.
 */
function frameCoordinates(left: Timeline, right: Timeline, index: number): {
  leftSeq?: number
  rightSeq?: number
  leftAtMs?: number
  rightAtMs?: number
} {
  const leftFrame = left.frames[index]
  const rightFrame = right.frames[index]
  return {
    ...leftFrame === undefined ? {} : { leftSeq: leftFrame.seq, leftAtMs: leftFrame.atMs },
    ...rightFrame === undefined ? {} : { rightSeq: rightFrame.seq, rightAtMs: rightFrame.atMs },
  }
}

/** Accumulated text of one side, for a coarse "what did each produce" view. */
export interface SideSummary {
  readonly frames: number
  readonly totalMs: number
  /** Concatenated assistant text (excludes reasoning and tool arguments). */
  readonly text: string
  /** Concatenated reasoning text. */
  readonly reasoning: string
  /** Distinct tool names seen, in first-seen order. */
  readonly tools: readonly string[]
}

/**
 * Summarize one whole timeline.
 *
 * Useful on its own (a compact "what happened" line) and as the basis of a
 * comparison table when two runs are shown side by side.
 * @param timeline - the timeline to summarize.
 * @returns the summary.
 */
export function summarize(timeline: Timeline): SideSummary {
  const stage = stageAt(timeline, timeline.frames.length - 1)
  const tools: string[] = []
  let text = ''
  let reasoning = ''
  for (const block of stage.blocks) {
    if (block.kind === 'text') text += block.text
    else if (block.kind === 'reasoning') reasoning += block.text
    else if (block.toolName !== undefined && !tools.includes(block.toolName)) {
      tools.push(block.toolName)
    }
  }
  return { frames: timeline.frames.length, totalMs: timeline.totalMs, text, reasoning, tools }
}
