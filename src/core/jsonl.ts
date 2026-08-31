/**
 * Read a recorded `session.jsonl` into history records.
 *
 * This is the offline half of the theater: a file dropped into the browser (or
 * read by a script) becomes the same `HistoryRecord[]` the live window
 * provides, so `buildTimeline` serves both paths unchanged.
 *
 * A JSONL storage line and a client wire record are NOT the same shape, and
 * conflating them is the easiest mistake to make here:
 *
 * | | storage line (this module's input) | client wire record |
 * |---|---|---|
 * | packed | `{ type: 'text-chunks', … }` | `{ type: 'chunks', event: { type: 'chunkrow/text-chunks', … } }` |
 * | scalar | the event itself | `{ type: 'event', event }` |
 *
 * Upstream's own decoder for the storage form is `decodeStorageRecord`
 * (packages/core/session/src/chunk-rows.ts:363); this module performs the
 * equivalent recognition and then lifts the result into wire records.
 *
 * @module dsh-replay-theater/core/jsonl
 */

import type { ChunkRowEvent, HistoryRecord, ScalarEvent } from './wire.ts'

/** Storage-form tags of a packed run. Mirrors chunk-rows.ts `ChunkRow['type']`. */
const PACKED_TAGS = ['text-chunks', 'reasoning-chunks', 'tool-call-chunks'] as const

/** One packed storage tag. */
type PackedTag = typeof PACKED_TAGS[number]

/** Outcome of parsing one file. */
export interface ParsedLog {
  readonly records: readonly HistoryRecord[]
  /** Lines that were not usable, with 1-based line numbers, for honest reporting. */
  readonly skipped: readonly { readonly line: number; readonly reason: string }[]
}

/**
 * Whether a value is a plain object.
 * @param value - candidate.
 * @returns true for a non-null, non-array object.
 */
function isRecordValue(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Whether a tag names a packed run.
 * @param tag - candidate tag.
 * @returns true for a packed storage tag.
 */
function isPackedTag(tag: unknown): tag is PackedTag {
  return typeof tag === 'string' && (PACKED_TAGS as readonly string[]).includes(tag)
}

/**
 * Lift one recognized packed storage line into a wire record.
 * @param value - the parsed line, already known to carry a packed tag.
 * @param tag - the packed tag.
 * @param seq - sequence to use when the line carries none.
 * @returns the wire record, or undefined when required fields are unusable.
 */
function liftPacked(
  value: Record<string, unknown>,
  tag: PackedTag,
  seq: number,
): HistoryRecord | undefined {
  const data = value['data']
  if (!isRecordValue(data)) return undefined
  const members = tag === 'tool-call-chunks' ? data['args'] : data['texts']
  if (!Array.isArray(members) || members.some(member => typeof member !== 'string')) return undefined
  const dtRaw = data['dt']
  const dt = Array.isArray(dtRaw) ? dtRaw.filter((gap): gap is number => typeof gap === 'number') : []
  const base = {
    turn: typeof data['turn'] === 'number' ? data['turn'] : 0,
    step: typeof data['step'] === 'number' ? data['step'] : 0,
    index: typeof data['index'] === 'number' ? data['index'] : 0,
    dt,
  }
  const resolvedSeq = typeof value['seq'] === 'number' ? value['seq'] : seq
  const time = typeof value['time'] === 'number' ? value['time'] : 0

  if (tag === 'tool-call-chunks') {
    const id = data['id']
    if (typeof id !== 'string') return undefined
    const name = data['name']
    const event: ChunkRowEvent = {
      type: 'chunkrow/tool-call-chunks',
      seq: resolvedSeq,
      time,
      data: {
        ...base,
        id,
        ...typeof name === 'string' ? { name } : {},
        args: members as string[],
      },
    }
    return { type: 'chunks', event }
  }

  const event: ChunkRowEvent = {
    type: tag === 'reasoning-chunks' ? 'chunkrow/reasoning-chunks' : 'chunkrow/text-chunks',
    seq: resolvedSeq,
    time,
    data: { ...base, texts: members as string[] },
  }
  return { type: 'chunks', event }
}

/**
 * Parse a recorded session log into history records.
 *
 * Normalized snapshot corpora strip `seq` and `time` (snapshots/AGENTS.md), so
 * a line without them gets its line-order sequence and a synthetic clock: the
 * result stays playable, only its cadence becomes uniform. Whether times were
 * synthesized is reported so a UI can say so rather than implying real cadence.
 *
 * @param text - the whole file contents.
 * @param options - synthetic clock settings for logs without timestamps.
 * @returns records plus a list of skipped lines.
 */
export function parseSessionLog(
  text: string,
  options: { readonly syntheticGapMs?: number } = {},
): ParsedLog & { readonly synthesizedTimes: boolean } {
  const syntheticGapMs = options.syntheticGapMs ?? 30
  const records: HistoryRecord[] = []
  const skipped: { line: number; reason: string }[] = []
  let seq = 0
  let clock = 0
  let synthesizedTimes = false

  const lines = text.split(/\r?\n/u)
  for (let index = 0; index < lines.length; index += 1) {
    const line = (lines[index] ?? '').trim()
    if (line === '') continue
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      skipped.push({ line: index + 1, reason: 'not JSON' })
      continue
    }
    if (!isRecordValue(parsed)) {
      skipped.push({ line: index + 1, reason: 'not an object' })
      continue
    }
    if (typeof parsed['type'] !== 'string') {
      skipped.push({ line: index + 1, reason: 'no event type' })
      continue
    }

    seq += 1
    if (typeof parsed['time'] !== 'number') {
      synthesizedTimes = true
      clock += syntheticGapMs
    }
    const time = typeof parsed['time'] === 'number' ? parsed['time'] : clock

    const tag = parsed['type']
    if (isPackedTag(tag)) {
      const lifted = liftPacked({ ...parsed, time }, tag, seq)
      if (lifted === undefined) {
        skipped.push({ line: index + 1, reason: `malformed ${tag} row` })
        continue
      }
      records.push(lifted)
      // A packed row represents many sequences; advance past its members so a
      // following scalar line does not collide with them.
      const members = lifted.type === 'chunks'
        ? (lifted.event.type === 'chunkrow/tool-call-chunks'
          ? lifted.event.data.args.length
          : lifted.event.data.texts.length)
        : 1
      seq += members - 1
      continue
    }

    const event: ScalarEvent = {
      ...parsed,
      type: tag,
      seq: typeof parsed['seq'] === 'number' ? parsed['seq'] : seq,
      time,
    }
    records.push({ type: 'event', event })
  }

  return { records, skipped, synthesizedTimes }
}
