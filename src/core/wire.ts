/**
 * Minimal structural mirror of the DeepSeek Harness session-history wire shapes
 * this plugin reads. Nothing here is imported from `@deepseek-ai/*` on purpose:
 * the core replay logic must stay testable without a harness checkout, and
 * `@deepseek-ai/dsh-api-session-controller` is not published to npm.
 *
 * These are TYPES ONLY and are structurally compatible with the upstream
 * declarations, so a future version can swap them for real `import type`s
 * without touching call sites. Each mirror records the upstream location it was
 * read from, pinned to commit 639ed01 (dsh@0.2.0-rc.2).
 *
 * ## What changed in 0.2.0 (why this file was rewritten)
 *
 * Until 0.1.x a history page carried two record kinds, and a "packed" one
 * spanned several logical sequences:
 *
 * ```
 * { type: 'chunks', event: { type: 'chunkrow/text-chunks', seq, time, data: { …, dt, texts } } }
 * ```
 *
 * Those `chunkrow/*` event types no longer exist: on 0.2.0 `chunkrow` has zero
 * hits in any `.ts`/`.tsx` under `packages/`. The one surviving mention is prose
 * that upstream did not update — packages/client/AGENTS.md:104 still tells
 * implementers to handle `chunkrow/*` branches — so a reader who trusts that
 * file will write against a type the compiler no longer has. Two upstream edges
 * removed them:
 *
 * 1. **v1→v2 folds the stream into the assistant event.** Top-level
 *    `assistant/chunk` events were consumed; an attempt now settles as one
 *    `assistant/message` (or `assistant/attempt` when it committed no surface
 *    message), carrying the timed stream in `data.stream`.
 * 2. **From format v2 on, one physical row holds exactly one event.** Upstream's
 *    own `historyRecordFirstSeq()` and `historyRecordLastSeq()` both return
 *    `record.event.seq` now (client/sessions/history-records.ts:24-35).
 *
 * The cadence data itself survived the move unchanged: `time0` / `index` / `dt`
 * / `texts` / `args` kept their names, they just live one level deeper.
 *
 * @module dsh-replay-theater/core/wire
 */

/**
 * One durable session event as it reaches the browser.
 *
 * Mirrors `SessionWireEvent` — packages/api/session-controller/src/types.ts:458.
 * `data` is declared `JsonValue` upstream, so every reader below validates its
 * shape at runtime instead of casting.
 */
export interface WireEvent {
  readonly type: string
  readonly seq: number
  readonly time: number
  readonly data?: unknown
  readonly [extra: string]: unknown
}

/**
 * Kept as an alias so call sites that only need `type`/`seq`/`time` to place a
 * marker read the same as before the 0.2.0 port.
 */
export type ScalarEvent = WireEvent

/**
 * One client history entry, retaining its coarse transport discriminator.
 *
 * Mirrors `SessionEventLikeEntry` —
 * packages/api/session-controller/src/client/contract/events.ts:23-25.
 *
 * `transient` entries are **client-only** provisional assistant frames. Upstream
 * replaces them atomically with a durable `assistant/message` /
 * `assistant/attempt` through the window's `settle-assistant` change
 * (same file, `:102-106`). Replay is about the settled record, so
 * {@link buildTimeline} ignores them rather than rendering a frame twice.
 */
export type HistoryRecord =
  | { readonly type: 'event'; readonly event: WireEvent }
  | { readonly type: 'transient'; readonly event: WireEvent }

/** The two settled event types that embed a timed assistant stream. */
export const ASSISTANT_STREAM_EVENT_TYPES = ['assistant/message', 'assistant/attempt'] as const

/**
 * One record inside a settled assistant event's `data.stream`.
 *
 * Mirrors `AssistantStreamRecord` — packages/llm/llm/src/assistant-stream.ts:20-47.
 * The first three variants are packed delta runs; the fourth carries a single
 * non-delta chunk the accumulator never packs.
 */
export type AssistantStreamRecord =
  | {
    readonly type: 'text-chunks'
    readonly time0: number
    readonly index: number
    readonly dt: readonly number[]
    readonly texts: readonly string[]
  }
  | {
    readonly type: 'reasoning-chunks'
    readonly time0: number
    readonly index: number
    readonly dt: readonly number[]
    readonly texts: readonly string[]
  }
  | {
    readonly type: 'tool-call-chunks'
    readonly time0: number
    readonly index: number
    readonly dt: readonly number[]
    readonly id: string
    readonly name?: string
    readonly args: readonly string[]
  }
  | { readonly type: 'chunk'; readonly time: number; readonly chunk?: unknown }

/**
 * One packed delta run: every compact record except a raw `chunk`.
 *
 * Mirrors `AssistantStreamRun` — assistant-stream.ts:47.
 */
export type AssistantStreamRun = Exclude<AssistantStreamRecord, { type: 'chunk' }>

/** Turn/step coordinates carried by a settled assistant event's `data`. */
export interface AssistantEventData {
  readonly turn?: number
  readonly step?: number
  readonly stream: readonly AssistantStreamRecord[]
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
 * Validate one stream member, rejecting anything structurally unusable.
 *
 * Runtime validation rather than a cast: `data` arrives as `JsonValue`, and a
 * member with a malformed `dt` would otherwise produce NaN playback positions
 * that are far harder to diagnose than a dropped member.
 * @param value - one candidate member of `data.stream`.
 * @returns the typed record, or undefined when it cannot be used.
 */
function streamRecord(value: unknown): AssistantStreamRecord | undefined {
  if (!isRecordValue(value)) return undefined
  const tag = value['type']

  if (tag === 'chunk') {
    if (typeof value['time'] !== 'number') return undefined
    return { type: 'chunk', time: value['time'], chunk: value['chunk'] }
  }

  if (tag !== 'text-chunks' && tag !== 'reasoning-chunks' && tag !== 'tool-call-chunks') return undefined
  if (typeof value['time0'] !== 'number') return undefined
  const index = typeof value['index'] === 'number' ? value['index'] : 0
  const dtRaw = value['dt']
  if (!Array.isArray(dtRaw) || dtRaw.some(gap => typeof gap !== 'number')) return undefined
  const dt = dtRaw as readonly number[]

  if (tag === 'tool-call-chunks') {
    const args = value['args']
    const id = value['id']
    if (!Array.isArray(args) || args.some(part => typeof part !== 'string')) return undefined
    if (typeof id !== 'string') return undefined
    const name = value['name']
    return {
      type: 'tool-call-chunks',
      time0: value['time0'],
      index,
      dt,
      id,
      ...typeof name === 'string' ? { name } : {},
      args: args as readonly string[],
    }
  }

  const texts = value['texts']
  if (!Array.isArray(texts) || texts.some(part => typeof part !== 'string')) return undefined
  return { type: tag, time0: value['time0'], index, dt, texts: texts as readonly string[] }
}

/**
 * Read the timed stream out of a settled assistant event.
 *
 * @param event - one durable wire event.
 * @returns the validated stream plus its turn/step, or undefined when the event
 *   is not a settled assistant event or carries no usable stream.
 */
export function assistantEventData(event: WireEvent): AssistantEventData | undefined {
  if (!(ASSISTANT_STREAM_EVENT_TYPES as readonly string[]).includes(event.type)) return undefined
  const data = event.data
  if (!isRecordValue(data)) return undefined
  const raw = data['stream']
  if (!Array.isArray(raw)) return undefined
  const stream: AssistantStreamRecord[] = []
  for (const member of raw) {
    const record = streamRecord(member)
    if (record !== undefined) stream.push(record)
  }
  if (stream.length === 0) return undefined
  return {
    ...typeof data['turn'] === 'number' ? { turn: data['turn'] } : {},
    ...typeof data['step'] === 'number' ? { step: data['step'] } : {},
    stream,
  }
}

/**
 * Read the inclusive last logical sequence a record represents.
 *
 * Ported from upstream `historyRecordLastSeq()` —
 * packages/api/session-controller/src/client/sessions/history-records.ts:33.
 * Since format v2 a record spans exactly one sequence, so the arithmetic this
 * used to do is gone. It stays in the exported surface because consumers of
 * this package reason in the same terms upstream does, and because the name
 * carries the version-sensitive fact that a settled attempt is ONE sequence —
 * a bare `.event.seq` at a call site would not.
 * @param record - one history entry.
 * @returns the inclusive final session sequence.
 */
export function recordLastSeq(record: HistoryRecord): number {
  return record.event.seq
}

/**
 * Read the member strings of one packed delta run, whichever payload it carries.
 * @param run - one packed run from a settled assistant stream.
 * @returns the per-member strings in log order.
 */
export function runMembers(run: AssistantStreamRun): readonly string[] {
  return run.type === 'tool-call-chunks' ? run.args : run.texts
}
