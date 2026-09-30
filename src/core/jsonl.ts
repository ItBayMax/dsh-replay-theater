/**
 * Read a recorded session log into history records.
 *
 * This is the offline half of the theater: a file dropped into the browser (or
 * read by a script) becomes the same `HistoryRecord[]` the live window
 * provides, so `buildTimeline` serves both paths unchanged.
 *
 * ## Two on-disk generations, one output shape
 *
 * Upstream's physical format changed with session format v2, and both
 * generations still exist on disk:
 *
 * | generation | filename | assistant deltas |
 * |---|---|---|
 * | 0 | `session.jsonl[.zstd]` | a **packed row** per run: `{ type: 'text-chunks', seq0, time0, data: { …, dt, texts } }`, spanning `seq0 … seq0+n-1` |
 * | 2+ (current is 4) | `session.vN.jsonl[.zstd]` | one row per event; a settled attempt is one `assistant/message` / `assistant/attempt` whose `data.stream` holds the same packed runs |
 *
 * Rather than branch on the header version, this parser **lifts** a generation-0
 * packed row into the current shape — which is what upstream's own v0→v1→v2
 * migration chain does semantically. Every other line has the same
 * `{ type, seq, time, data }` envelope in both generations and passes straight
 * through, so {@link buildTimeline} only ever sees one record shape.
 *
 * The `seq0`/`time0` naming of a generation-0 packed row is easy to miss: it was
 * verified against a real 5777-line production log, of which 2455 rows are
 * packed and carry `seq0`/`time0`, 1267 are scalar and carry `seq`/`time`, and
 * the first line is a session header with NEITHER.
 *
 * @module dsh-replay-theater/core/jsonl
 */

import type { AssistantStreamRecord, HistoryRecord, WireEvent } from './wire.ts'

/** Generation-0 tags of a packed run, as they appear at the top level of a line. */
const PACKED_TAGS = ['text-chunks', 'reasoning-chunks', 'tool-call-chunks'] as const

/** One generation-0 packed tag. */
type PackedTag = typeof PACKED_TAGS[number]

/** The settled event type a lifted generation-0 run is attributed to. */
const LIFTED_EVENT_TYPE = 'assistant/message'

/** Outcome of parsing one file. */
export interface ParsedLog {
  readonly records: readonly HistoryRecord[]
  /** Lines that were not usable, with 1-based line numbers, for honest reporting. */
  readonly skipped: readonly { readonly line: number; readonly reason: string }[]
  /**
   * The log's session header line when present. It is session metadata rather
   * than an event (no `seq`, no `time`), so it stays out of `records`.
   */
  readonly header?: Record<string, unknown>
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
 * Whether a tag names a generation-0 packed run.
 * @param tag - candidate tag.
 * @returns true for a packed storage tag.
 */
function isPackedTag(tag: unknown): tag is PackedTag {
  return typeof tag === 'string' && (PACKED_TAGS as readonly string[]).includes(tag)
}

/**
 * Lift one recognized generation-0 packed line into a current-shape record.
 *
 * @param value - the parsed line, already known to carry a packed tag.
 * @param tag - the packed tag.
 * @param fallbackSeq - sequence to use when the line carries none.
 * @param fallbackTime - timestamp to use when the line carries none.
 * @returns the record plus how many sequences the original row spanned, or
 *   undefined when required fields are unusable.
 */
function liftPacked(
  value: Record<string, unknown>,
  tag: PackedTag,
  fallbackSeq: number,
  fallbackTime: number,
): { readonly record: HistoryRecord; readonly span: number } | undefined {
  const data = value['data']
  if (!isRecordValue(data)) return undefined
  const members = tag === 'tool-call-chunks' ? data['args'] : data['texts']
  if (!Array.isArray(members) || members.some(member => typeof member !== 'string')) return undefined
  // Tolerant on purpose: a generation-0 file is old data nobody can re-record,
  // so a single malformed gap should not cost the whole run. The cost is that a
  // dropped gap shortens `dt`, which shifts later members earlier by that gap —
  // the run still plays, just slightly compressed. Current-format streams take
  // the strict path in wire.ts instead, where a malformed member is a live bug.
  const dtRaw = data['dt']
  const dt = Array.isArray(dtRaw) ? dtRaw.filter((gap): gap is number => typeof gap === 'number') : []
  const index = typeof data['index'] === 'number' ? data['index'] : 0

  // Generation-0 rows name these `seq0`/`time0`; the `seq`/`time` fallback
  // covers a hand-written or already-lifted row.
  const seq = typeof value['seq0'] === 'number'
    ? value['seq0']
    : typeof value['seq'] === 'number' ? value['seq'] : fallbackSeq
  const time = typeof value['time0'] === 'number'
    ? value['time0']
    : typeof value['time'] === 'number' ? value['time'] : fallbackTime

  let member: AssistantStreamRecord
  if (tag === 'tool-call-chunks') {
    const id = data['id']
    if (typeof id !== 'string') return undefined
    const name = data['name']
    member = {
      type: 'tool-call-chunks',
      time0: time,
      index,
      dt,
      id,
      ...typeof name === 'string' ? { name } : {},
      args: members as string[],
    }
  } else {
    member = { type: tag, time0: time, index, dt, texts: members as string[] }
  }

  const event: WireEvent = {
    type: LIFTED_EVENT_TYPE,
    seq,
    time,
    data: {
      ...typeof data['turn'] === 'number' ? { turn: data['turn'] } : {},
      ...typeof data['step'] === 'number' ? { step: data['step'] } : {},
      stream: [member],
    },
  }
  return { record: { type: 'event', event }, span: members.length }
}

/**
 * Parse a recorded session log into history records.
 *
 * Normalized snapshot corpora strip `seq` and `time`, so a line without them
 * gets its line-order sequence and a synthetic clock: the result stays playable,
 * only its cadence becomes uniform. Whether times were synthesized is reported
 * so a UI can say so rather than implying real cadence.
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
  let header: Record<string, unknown> | undefined
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

    // The session header is metadata, not an event: it carries an id and cwd but
    // no sequence, and letting it consume seq 0 would shift every real event.
    if (parsed['type'] === 'session' && parsed['seq'] === undefined && parsed['id'] !== undefined) {
      header = parsed
      continue
    }

    seq += 1
    const storedTime = typeof parsed['time0'] === 'number'
      ? parsed['time0']
      : typeof parsed['time'] === 'number' ? parsed['time'] : undefined
    if (storedTime === undefined) {
      synthesizedTimes = true
      clock += syntheticGapMs
    }
    const time = storedTime ?? clock

    const tag = parsed['type']
    if (isPackedTag(tag)) {
      const lifted = liftPacked(parsed, tag, seq, time)
      if (lifted === undefined) {
        skipped.push({ line: index + 1, reason: `malformed ${tag} row` })
        continue
      }
      records.push(lifted.record)
      // A generation-0 packed row represented many sequences; advance past them
      // so a following scalar line does not collide with what it consumed.
      seq += lifted.span - 1
      continue
    }

    const event: WireEvent = {
      ...parsed,
      type: tag,
      seq: typeof parsed['seq'] === 'number' ? parsed['seq'] : seq,
      time,
    }
    records.push({ type: 'event', event })
  }

  return { records, skipped, synthesizedTimes, ...header === undefined ? {} : { header } }
}
