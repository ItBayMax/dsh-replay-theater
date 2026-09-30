/**
 * Behavior of the timeline builder: cadence, clamping, ordering, accumulation.
 *
 * @module dsh-replay-theater/tests/timeline
 */

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { buildTimeline, DEFAULT_MAX_GAP_MS, frameIndexAt, stageAt, SYNTHETIC_CHUNK_MARKER } from '../src/core/timeline.ts'
import type { HistoryRecord } from '../src/core/wire.ts'
import { assistantEventData, recordLastSeq } from '../src/core/wire.ts'
import { assistantEvent, reasoningRun, scalar, T0, textRun, toolRun, transient } from './fixtures/synthetic.ts'

describe('buildTimeline', () => {
  it('places the first frame at zero and spaces later frames by their gaps', () => {
    const timeline = buildTimeline([
      textRun({ seq: 1, time: T0, texts: ['He', 'llo', '!'], dt: [40, 60] }),
    ])
    expect(timeline.frames.map(frame => frame.atMs)).toEqual([0, 40, 100])
    expect(timeline.totalMs).toBe(100)
  })

  it('assigns one frame per member, all sharing the attempt sequence', () => {
    // Since session format v2 a settled attempt occupies ONE sequence, so every
    // frame expanded out of its stream carries that same seq. Ordering inside
    // the attempt comes from stream position, not from arithmetic on seq.
    const timeline = buildTimeline([
      textRun({ seq: 10, time: T0, texts: ['a', 'b', 'c', 'd'], dt: [5, 5, 5] }),
    ])
    expect(timeline.frames).toHaveLength(4)
    expect(timeline.frames.map(frame => frame.seq)).toEqual([10, 10, 10, 10])
    expect(timeline.frames.map(frame => frame.atMs)).toEqual([0, 5, 10, 15])
  })

  it('keeps members of one attempt in stream order when a later attempt sorts first', () => {
    // Concatenated windows may arrive out of order; the seq tiebreak must not
    // scramble the members of a single attempt.
    const timeline = buildTimeline([
      textRun({ seq: 20, time: T0 + 100, texts: ['x', 'y'], dt: [5] }),
      textRun({ seq: 10, time: T0, texts: ['a', 'b'], dt: [5] }),
    ])
    expect(timeline.frames.map(frame => frame.payload.kind === 'text' ? frame.payload.text : '?'))
      .toEqual(['a', 'b', 'x', 'y'])
  })

  it('ignores client-only transient frames', () => {
    // Upstream replaces them atomically with the settled event; replaying both
    // would play every token twice.
    const timeline = buildTimeline([
      transient({ seq: 10, time: T0 }),
      textRun({ seq: 10, time: T0, texts: ['a', 'b'], dt: [5] }),
    ])
    expect(timeline.frames).toHaveLength(2)
  })

  it('places a non-delta stream member on the marker rail', () => {
    // Upstream's fourth AssistantStreamRecord variant carries a single chunk the
    // accumulator never packs (real snapshots use it for block-start). It has no
    // member strings, so dropping it would silently lose a timing point.
    const timeline = buildTimeline([
      assistantEvent({
        seq: 3,
        time: T0,
        stream: [
          { type: 'chunk', time: T0, chunk: { type: 'block-start', index: 0 } },
          { type: 'text-chunks', time0: T0 + 10, index: 0, dt: [], texts: ['a'] },
        ],
      }),
    ])
    expect(timeline.frames).toHaveLength(2)
    const first = timeline.frames[0]?.payload
    expect(first?.kind).toBe('marker')
    expect(first?.kind === 'marker' && first.event.type).toBe(SYNTHETIC_CHUNK_MARKER)
  })

  it('clamps a negative gap to zero rather than moving time backwards', () => {
    // A negative gap is still reachable on 0.2.0: `safeGap` is a bare
    // `next - previous` with no non-negativity check (assistant-stream.ts:94-97),
    // and `validateRun` only requires safe integers (:510), so a wall clock that
    // stepped backwards lands a negative gap on the wire intact.
    const timeline = buildTimeline([
      textRun({ seq: 1, time: T0, texts: ['a', 'b', 'c'], dt: [-500, 30] }),
    ])
    expect(timeline.frames.map(frame => frame.atMs)).toEqual([0, 0, 30])
  })

  it('compresses a gap longer than maxGapMs and reports what it removed', () => {
    const timeline = buildTimeline(
      [textRun({ seq: 1, time: T0, texts: ['a', 'b'], dt: [30_000] })],
      { maxGapMs: 500 },
    )
    expect(timeline.frames.map(frame => frame.atMs)).toEqual([0, 500])
    expect(timeline.compressedGaps).toBe(1)
    expect(timeline.compressedMs).toBe(29_500)
  })

  it('clamps the silence BETWEEN records, not only within a run', () => {
    // A long pause between two steps would stall playback just as badly as a
    // long pause inside one run, so both go through the same clamp.
    const timeline = buildTimeline(
      [
        textRun({ seq: 1, time: T0, texts: ['a', 'b'], dt: [10] }),
        textRun({ seq: 3, time: T0 + 120_000, texts: ['c', 'd'], dt: [10] }),
      ],
      { maxGapMs: 1000 },
    )
    expect(timeline.frames.map(frame => frame.atMs)).toEqual([0, 10, 1010, 1020])
    expect(timeline.compressedGaps).toBe(1)
  })

  it('uses the documented default ceiling when none is given', () => {
    const timeline = buildTimeline([
      textRun({ seq: 1, time: T0, texts: ['a', 'b'], dt: [999_999] }),
    ])
    expect(timeline.totalMs).toBe(DEFAULT_MAX_GAP_MS)
  })

  it('keeps true wall-clock cadence when the ceiling is disabled', () => {
    const timeline = buildTimeline(
      [textRun({ seq: 1, time: T0, texts: ['a', 'b'], dt: [45_000] })],
      { maxGapMs: Infinity },
    )
    expect(timeline.totalMs).toBe(45_000)
    expect(timeline.compressedGaps).toBe(0)
  })

  it('carries turn and step through packed runs', () => {
    const timeline = buildTimeline([
      textRun({ seq: 1, time: T0, texts: ['a'], dt: [], turn: 4, step: 2 }),
    ])
    expect(timeline.frames[0]?.turn).toBe(4)
    expect(timeline.frames[0]?.step).toBe(2)
  })

  it('distinguishes text, reasoning and tool-argument payloads', () => {
    const timeline = buildTimeline([
      reasoningRun({ seq: 1, time: T0, texts: ['think'], dt: [] }),
      textRun({ seq: 2, time: T0 + 10, texts: ['say'], dt: [] }),
      toolRun({ seq: 3, time: T0 + 20, args: ['{"a":1}'], dt: [], id: 'call-1', name: 'read' }),
    ])
    expect(timeline.frames.map(frame => frame.payload.kind)).toEqual([
      'reasoning',
      'text',
      'tool-args',
    ])
    const tool = timeline.frames[2]?.payload
    expect(tool?.kind === 'tool-args' && tool.callId).toBe('call-1')
    expect(tool?.kind === 'tool-args' && tool.toolName).toBe('read')
  })

  it('omits toolName when the run does not carry one', () => {
    const timeline = buildTimeline([
      toolRun({ seq: 1, time: T0, args: ['x'], dt: [], id: 'call-9' }),
    ])
    const payload = timeline.frames[0]?.payload
    expect(payload?.kind === 'tool-args' && payload.toolName).toBeUndefined()
  })

  it('turns scalar events into marker frames', () => {
    const timeline = buildTimeline([
      scalar({ type: 'step/start', seq: 1, time: T0 }),
      textRun({ seq: 2, time: T0 + 10, texts: ['a'], dt: [] }),
    ])
    expect(timeline.frames[0]?.payload.kind).toBe('marker')
    const marker = timeline.frames[0]?.payload
    expect(marker?.kind === 'marker' && marker.event.type).toBe('step/start')
  })

  it('orders by sequence even when records arrive out of order', () => {
    // A caller may concatenate windows; sequence is authoritative, timestamps
    // are not trusted for ordering.
    const timeline = buildTimeline([
      textRun({ seq: 5, time: T0 + 100, texts: ['second'], dt: [] }),
      textRun({ seq: 1, time: T0, texts: ['first'], dt: [] }),
    ])
    expect(timeline.frames.map(frame => frame.seq)).toEqual([1, 5])
  })

  it('returns an empty timeline for no records', () => {
    const timeline = buildTimeline([])
    expect(timeline.frames).toEqual([])
    expect(timeline.totalMs).toBe(0)
  })

  it('returns a zero-length timeline for a single frame', () => {
    const timeline = buildTimeline([textRun({ seq: 1, time: T0, texts: ['only'], dt: [] })])
    expect(timeline.frames).toHaveLength(1)
    expect(timeline.totalMs).toBe(0)
  })

  it('tolerates a dt array shorter than the member count', () => {
    // Defensive: the wire is validated upstream, but a truncated array must not
    // produce NaN timings.
    const timeline = buildTimeline([
      textRun({ seq: 1, time: T0, texts: ['a', 'b', 'c'], dt: [10] }),
    ])
    expect(timeline.frames.map(frame => frame.atMs)).toEqual([0, 10, 10])
  })

  it('expands a run as long as the longest one upstream actually records', () => {
    // 2047 is not arbitrary: it is the largest single run in the upstream
    // snapshot corpus on 639ed01 (a tool-call run in web/present-svg). Every
    // other fixture here is a handful of members, so without this the
    // per-member accumulation is only ever exercised at toy scale.
    const size = 2047
    const texts = Array.from({ length: size }, (_, i) => `${i % 10}`)
    const dt = Array.from({ length: size - 1 }, () => 1)
    const timeline = buildTimeline([textRun({ seq: 1, time: T0, texts, dt })])

    expect(timeline.frames).toHaveLength(size)
    expect(timeline.totalMs).toBe(size - 1)
    // One attempt is one sequence however many members it holds.
    expect(new Set(timeline.frames.map(frame => frame.seq)).size).toBe(1)
    // Accumulation must reach the final member, not stop early.
    expect(stageAt(timeline, size - 1).blocks[0]?.text).toBe(texts.join(''))
  })
})

describe('frameIndexAt', () => {
  const timeline = buildTimeline([
    textRun({ seq: 1, time: T0, texts: ['a', 'b', 'c'], dt: [100, 100] }),
  ])

  it('finds the last frame at or before a position', () => {
    expect(frameIndexAt(timeline, 0)).toBe(0)
    expect(frameIndexAt(timeline, 99)).toBe(0)
    expect(frameIndexAt(timeline, 100)).toBe(1)
    expect(frameIndexAt(timeline, 250)).toBe(2)
  })

  it('reports -1 before the first frame', () => {
    expect(frameIndexAt(timeline, -1)).toBe(-1)
  })

  it('reports -1 on an empty timeline', () => {
    expect(frameIndexAt(buildTimeline([]), 0)).toBe(-1)
  })
})

describe('stageAt', () => {
  it('does not merge a retried attempt into the abandoned one', () => {
    // A retried step settles as an `assistant/attempt` (the try that was thrown
    // away) followed by an `assistant/message`. Both can carry the same turn,
    // step and block index, so without the sequence in the block identity the
    // two texts would concatenate and read as one continuous answer.
    const timeline = buildTimeline([
      assistantEvent({
        seq: 5,
        time: T0,
        type: 'assistant/attempt',
        stream: [{ type: 'text-chunks', time0: T0, index: 0, dt: [], texts: ['abandoned'] }],
      }),
      assistantEvent({
        seq: 6,
        time: T0 + 50,
        stream: [{ type: 'text-chunks', time0: T0 + 50, index: 0, dt: [], texts: ['final'] }],
      }),
    ])
    const stage = stageAt(timeline, timeline.frames.length - 1)
    expect(stage.blocks).toHaveLength(2)
    expect(stage.blocks.map(block => block.text)).toEqual(['abandoned', 'final'])
    expect(stage.blocks.map(block => block.seq)).toEqual([5, 6])
  })

  it('still merges consecutive members of one attempt into a single block', () => {
    const timeline = buildTimeline([
      textRun({ seq: 9, time: T0, texts: ['Hel', 'lo', '!'], dt: [1, 1] }),
    ])
    const stage = stageAt(timeline, timeline.frames.length - 1)
    expect(stage.blocks).toHaveLength(1)
    expect(stage.blocks[0]?.text).toBe('Hello!')
    expect(stage.blocks[0]?.seq).toBe(9)
  })

  it('concatenates consecutive members of one block into one paragraph', () => {
    const timeline = buildTimeline([
      textRun({ seq: 1, time: T0, texts: ['Hel', 'lo ', 'world'], dt: [5, 5] }),
    ])
    const stage = stageAt(timeline, 2)
    expect(stage.blocks).toHaveLength(1)
    expect(stage.blocks[0]?.text).toBe('Hello world')
  })

  it('grows the text as the position advances', () => {
    const timeline = buildTimeline([
      textRun({ seq: 1, time: T0, texts: ['a', 'b', 'c'], dt: [5, 5] }),
    ])
    expect(stageAt(timeline, -1).blocks).toEqual([])
    expect(stageAt(timeline, 0).blocks[0]?.text).toBe('a')
    expect(stageAt(timeline, 1).blocks[0]?.text).toBe('ab')
    expect(stageAt(timeline, 2).blocks[0]?.text).toBe('abc')
  })

  it('starts a new block when the block index changes', () => {
    const timeline = buildTimeline([
      textRun({ seq: 1, time: T0, texts: ['first'], dt: [], block: 0 }),
      textRun({ seq: 2, time: T0 + 5, texts: ['second'], dt: [], block: 1 }),
    ])
    const stage = stageAt(timeline, 1)
    expect(stage.blocks.map(block => block.text)).toEqual(['first', 'second'])
  })

  it('starts a new block when the step changes', () => {
    const timeline = buildTimeline([
      textRun({ seq: 1, time: T0, texts: ['s1'], dt: [], step: 1 }),
      textRun({ seq: 2, time: T0 + 5, texts: ['s2'], dt: [], step: 2 }),
    ])
    expect(stageAt(timeline, 1).blocks).toHaveLength(2)
  })

  it('keeps reasoning separate from text in the same block index', () => {
    const timeline = buildTimeline([
      reasoningRun({ seq: 1, time: T0, texts: ['why'], dt: [], block: 0 }),
      textRun({ seq: 2, time: T0 + 5, texts: ['what'], dt: [], block: 0 }),
    ])
    const stage = stageAt(timeline, 1)
    expect(stage.blocks.map(block => block.kind)).toEqual(['reasoning', 'text'])
  })

  it('separates tool-argument blocks by call id', () => {
    const timeline = buildTimeline([
      toolRun({ seq: 1, time: T0, args: ['{"a"'], dt: [], id: 'c1', name: 'read' }),
      toolRun({ seq: 2, time: T0 + 5, args: ['{"b"'], dt: [], id: 'c2', name: 'write' }),
    ])
    const stage = stageAt(timeline, 1)
    expect(stage.blocks.map(block => block.callId)).toEqual(['c1', 'c2'])
    expect(stage.blocks.map(block => block.toolName)).toEqual(['read', 'write'])
  })

  it('collects markers separately from streamed blocks', () => {
    const timeline = buildTimeline([
      scalar({ type: 'step/start', seq: 1, time: T0 }),
      textRun({ seq: 2, time: T0 + 5, texts: ['hi'], dt: [] }),
      scalar({ type: 'step/end', seq: 3, time: T0 + 10 }),
    ])
    const stage = stageAt(timeline, 2)
    expect(stage.markers.map(event => event.type)).toEqual(['step/start', 'step/end'])
    expect(stage.blocks).toHaveLength(1)
  })

  it('clamps an index past the end instead of throwing', () => {
    const timeline = buildTimeline([textRun({ seq: 1, time: T0, texts: ['a'], dt: [] })])
    expect(stageAt(timeline, 999).blocks[0]?.text).toBe('a')
  })
})

describe('recordLastSeq', () => {
  it('reports the single sequence of a scalar record', () => {
    expect(recordLastSeq(scalar({ type: 'turn/start', seq: 7, time: T0 }))).toBe(7)
  })

  it('reports the single sequence of a settled text attempt', () => {
    // Was `seq + members - 1` before format v2; a settled attempt is now one seq
    // however many members its stream holds.
    expect(recordLastSeq(textRun({ seq: 10, time: T0, texts: ['a', 'b', 'c'], dt: [1, 1] }))).toBe(10)
  })

  it('reports the single sequence of a settled tool attempt', () => {
    expect(recordLastSeq(toolRun({ seq: 4, time: T0, args: ['x', 'y'], dt: [1], id: 'c' }))).toBe(4)
  })
})

describe('real upstream shapes', () => {
  // Derived from snapshots/acp/escalation-approved/session.v3.jsonl at dsh 639ed01.
  // The corpus normalizes seq/time away, so the derivation script re-adds them;
  // what this fixture proves is that our wire mirror accepts the record and
  // event SHAPES real sessions produce.
  const fixture = JSON.parse(
    readFileSync(new URL('./fixtures/corpus-escalation-approved.json', import.meta.url), 'utf8'),
  ) as { records: HistoryRecord[] }

  it('builds a timeline from a real recorded session', () => {
    const timeline = buildTimeline(fixture.records)
    // Streams expand, so there are strictly more frames than records.
    expect(timeline.frames.length).toBeGreaterThan(fixture.records.length)
    expect(timeline.totalMs).toBeGreaterThan(0)
  })

  it('keeps frame times monotonic non-decreasing', () => {
    const timeline = buildTimeline(fixture.records)
    for (let i = 1; i < timeline.frames.length; i += 1) {
      const previous = timeline.frames[i - 1]?.atMs ?? 0
      expect(timeline.frames[i]?.atMs).toBeGreaterThanOrEqual(previous)
    }
  })

  it('keeps frame sequences non-decreasing', () => {
    // Strictly increasing no longer holds: every frame of one settled attempt
    // shares that attempt's sequence.
    const timeline = buildTimeline(fixture.records)
    for (let i = 1; i < timeline.frames.length; i += 1) {
      expect(timeline.frames[i]?.seq).toBeGreaterThanOrEqual(timeline.frames[i - 1]?.seq ?? -1)
    }
  })

  it('exercises both event paths in one fixture', () => {
    // Every record is an `event` now; the two paths the builder takes are
    // "settled assistant event with a stream" and "scalar marker".
    expect(new Set(fixture.records.map(record => record.type))).toEqual(new Set(['event']))
    const withStream = fixture.records.filter(record => assistantEventData(record.event) !== undefined)
    expect(withStream.length).toBeGreaterThan(0)
    expect(withStream.length).toBeLessThan(fixture.records.length)
  })

  it('covers every stream member variant upstream emits', () => {
    const variants = new Set(fixture.records.flatMap(record =>
      (assistantEventData(record.event)?.stream ?? []).map(member => member.type)))
    expect(variants).toEqual(new Set(['chunk', 'text-chunks', 'reasoning-chunks', 'tool-call-chunks']))
  })

  it('accumulates a stage without throwing on real marker types', () => {
    const timeline = buildTimeline(fixture.records)
    const stage = stageAt(timeline, timeline.frames.length - 1)
    expect(stage.markers.length).toBeGreaterThan(0)
  })
})
