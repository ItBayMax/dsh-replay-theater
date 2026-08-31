/**
 * v2 behavior: offline log parsing and side-by-side divergence.
 *
 * @module dsh-replay-theater/tests/v2
 */

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { findDivergence, summarize } from '../src/core/compare.ts'
import { parseSessionLog } from '../src/core/jsonl.ts'
import { buildTimeline } from '../src/core/timeline.ts'
import { reasoningRun, scalar, T0, textRun, toolRun } from './fixtures/synthetic.ts'

describe('parseSessionLog', () => {
  it('reads scalar lines into event records', () => {
    const log = [
      '{"type":"turn/start","seq":1,"time":1000}',
      '{"type":"step/start","seq":2,"time":1010}',
    ].join('\n')
    const parsed = parseSessionLog(log)
    expect(parsed.records).toHaveLength(2)
    expect(parsed.records[0]?.type).toBe('event')
    expect(parsed.synthesizedTimes).toBe(false)
  })

  it('lifts a packed text row from storage form into wire form', () => {
    // Storage form is `text-chunks`; wire form is `chunks` + `chunkrow/text-chunks`.
    const log = '{"type":"text-chunks","seq":5,"time":2000,"data":{"turn":1,"step":1,"index":0,"dt":[10,20],"texts":["a","b","c"]}}'
    const parsed = parseSessionLog(log)
    const record = parsed.records[0]
    expect(record?.type).toBe('chunks')
    expect(record?.type === 'chunks' && record.event.type).toBe('chunkrow/text-chunks')
    expect(record?.type === 'chunks' && record.event.data.dt).toEqual([10, 20])
  })

  it('lifts a packed tool row and keeps its call identity', () => {
    const log = '{"type":"tool-call-chunks","seq":1,"time":0,"data":{"turn":1,"step":1,"index":0,"dt":[5],"id":"call-7","name":"read","args":["{\\"p\\"","}"]}}'
    const record = parseSessionLog(log).records[0]
    expect(record?.type === 'chunks' && record.event.type).toBe('chunkrow/tool-call-chunks')
    const toolEvent = record?.type === 'chunks' && record.event.type === 'chunkrow/tool-call-chunks'
      ? record.event
      : undefined
    expect(toolEvent?.data.id).toBe('call-7')
  })

  it('lifts a reasoning row', () => {
    const log = '{"type":"reasoning-chunks","seq":1,"time":0,"data":{"turn":1,"step":1,"index":0,"dt":[],"texts":["hmm"]}}'
    const record = parseSessionLog(log).records[0]
    expect(record?.type === 'chunks' && record.event.type).toBe('chunkrow/reasoning-chunks')
  })

  it('synthesizes a clock for a normalized log that has no timestamps', () => {
    // Upstream snapshot corpora strip seq/time; the log must still be playable.
    const log = ['{"type":"turn/start"}', '{"type":"step/start"}'].join('\n')
    const parsed = parseSessionLog(log, { syntheticGapMs: 40 })
    expect(parsed.synthesizedTimes).toBe(true)
    const timeline = buildTimeline(parsed.records)
    expect(timeline.frames.map(frame => frame.atMs)).toEqual([0, 40])
  })

  it('assigns line-order sequences when the log carries none', () => {
    const parsed = parseSessionLog(['{"type":"a"}', '{"type":"b"}'].join('\n'))
    expect(parsed.records.map(record => record.event.seq)).toEqual([1, 2])
  })

  it('advances past a packed row so a following line does not collide', () => {
    const log = [
      '{"type":"text-chunks","data":{"turn":1,"step":1,"index":0,"dt":[1,1],"texts":["a","b","c"]}}',
      '{"type":"step/end"}',
    ].join('\n')
    const parsed = parseSessionLog(log)
    // Members occupy 1..3, so the scalar must land at 4.
    expect(parsed.records[1]?.event.seq).toBe(4)
  })

  it('skips blank lines without reporting them', () => {
    const parsed = parseSessionLog('\n\n{"type":"a","seq":1,"time":0}\n\n')
    expect(parsed.records).toHaveLength(1)
    expect(parsed.skipped).toEqual([])
  })

  it('reports unparseable lines with their line numbers', () => {
    const parsed = parseSessionLog(['{"type":"a","seq":1,"time":0}', 'not json'].join('\n'))
    expect(parsed.records).toHaveLength(1)
    expect(parsed.skipped).toEqual([{ line: 2, reason: 'not JSON' }])
  })

  it('reports a line that is valid JSON but not an event', () => {
    expect(parseSessionLog('[1,2,3]').skipped[0]?.reason).toBe('not an object')
  })

  it('reports a line with no event type', () => {
    expect(parseSessionLog('{"seq":1}').skipped[0]?.reason).toBe('no event type')
  })

  it('reports a malformed packed row instead of dropping it silently', () => {
    // Upstream treats a malformed row as corrupt storage rather than an event.
    const log = '{"type":"text-chunks","data":{"texts":"not an array"}}'
    const parsed = parseSessionLog(log)
    expect(parsed.records).toEqual([])
    expect(parsed.skipped[0]?.reason).toContain('malformed text-chunks')
  })

  it('rejects a tool row without a call id', () => {
    const log = '{"type":"tool-call-chunks","data":{"dt":[],"args":["x"]}}'
    expect(parseSessionLog(log).skipped).toHaveLength(1)
  })

  it('tolerates non-numeric gaps inside dt', () => {
    const log = '{"type":"text-chunks","data":{"dt":[10,"bad",20],"texts":["a","b","c"]}}'
    const record = parseSessionLog(log).records[0]
    expect(record?.type === 'chunks' && record.event.data.dt).toEqual([10, 20])
  })

  it('parses a real recorded session end to end', () => {
    const path = new URL(
      '../../../deepseek-harness/snapshots/acp/escalation-approved/session.jsonl',
      import.meta.url,
    )
    const parsed = parseSessionLog(readFileSync(path, 'utf8'))
    expect(parsed.records.length).toBeGreaterThan(10)
    expect(parsed.skipped).toEqual([])
    const timeline = buildTimeline(parsed.records)
    expect(timeline.frames.length).toBeGreaterThan(10)
  })
})

describe('findDivergence', () => {
  const hello = buildTimeline([textRun({ seq: 1, time: T0, texts: ['Hel', 'lo'], dt: [10] })])

  it('reports identical timelines', () => {
    const other = buildTimeline([textRun({ seq: 1, time: T0, texts: ['Hel', 'lo'], dt: [10] })])
    const result = findDivergence(hello, other)
    expect(result.kind).toBe('identical')
    expect(result.kind === 'identical' && result.comparedFrames).toBe(2)
  })

  it('ignores timing and sequence differences', () => {
    // Two runs of the same task have different clocks and numbering; comparing
    // those would report divergence on every pair.
    const shifted = buildTimeline([
      textRun({ seq: 9_000, time: T0 + 5_000_000, texts: ['Hel', 'lo'], dt: [999] }),
    ])
    expect(findDivergence(hello, shifted).kind).toBe('identical')
  })

  it('finds the first differing token', () => {
    const other = buildTimeline([textRun({ seq: 1, time: T0, texts: ['Hel', 'p!'], dt: [10] })])
    const result = findDivergence(hello, other)
    expect(result.kind === 'diverged' && result.atFrame).toBe(1)
    expect(result.kind === 'diverged' && result.reason).toBe('text')
  })

  it('reports the seek coordinates of the divergence on both sides', () => {
    const other = buildTimeline([textRun({ seq: 50, time: T0, texts: ['Hel', 'p!'], dt: [70] })])
    const result = findDivergence(hello, other)
    expect(result.kind === 'diverged' && result.leftAtMs).toBe(10)
    expect(result.kind === 'diverged' && result.rightAtMs).toBe(70)
    expect(result.kind === 'diverged' && result.leftSeq).toBe(2)
    expect(result.kind === 'diverged' && result.rightSeq).toBe(51)
  })

  it('detects a payload-kind change', () => {
    const reasoningFirst = buildTimeline([
      reasoningRun({ seq: 1, time: T0, texts: ['Hel'], dt: [] }),
    ])
    const textFirst = buildTimeline([textRun({ seq: 1, time: T0, texts: ['Hel'], dt: [] })])
    const result = findDivergence(reasoningFirst, textFirst)
    expect(result.kind === 'diverged' && result.reason).toBe('payload-kind')
    expect(result.kind === 'diverged' && result.atFrame).toBe(0)
  })

  it('detects a marker-type change', () => {
    const left = buildTimeline([scalar({ type: 'tool/result', seq: 1, time: T0 })])
    const right = buildTimeline([scalar({ type: 'turn/end', seq: 1, time: T0 })])
    expect(findDivergence(left, right).kind === 'diverged').toBe(true)
  })

  it('reports which side ended when one is a prefix of the other', () => {
    const longer = buildTimeline([
      textRun({ seq: 1, time: T0, texts: ['Hel', 'lo', ' there'], dt: [10, 10] }),
    ])
    const result = findDivergence(hello, longer)
    expect(result.kind === 'diverged' && result.reason).toBe('left-ended')
    expect(result.kind === 'diverged' && result.atFrame).toBe(2)
  })

  it('reports right-ended in the mirror case', () => {
    const longer = buildTimeline([
      textRun({ seq: 1, time: T0, texts: ['Hel', 'lo', ' there'], dt: [10, 10] }),
    ])
    const result = findDivergence(longer, hello)
    expect(result.kind === 'diverged' && result.reason).toBe('right-ended')
  })

  it('calls two empty timelines identical', () => {
    const empty = buildTimeline([])
    expect(findDivergence(empty, empty).kind).toBe('identical')
  })

  it('reports divergence at frame 0 when one side is empty', () => {
    const result = findDivergence(buildTimeline([]), hello)
    expect(result.kind === 'diverged' && result.atFrame).toBe(0)
    expect(result.kind === 'diverged' && result.leftAtMs).toBeUndefined()
  })
})

describe('summarize', () => {
  it('separates assistant text from reasoning and lists tools', () => {
    const timeline = buildTimeline([
      reasoningRun({ seq: 1, time: T0, texts: ['think'], dt: [] }),
      textRun({ seq: 2, time: T0 + 10, texts: ['answer'], dt: [], block: 1 }),
      toolRun({ seq: 3, time: T0 + 20, args: ['{}'], dt: [], id: 'c1', name: 'read' }),
    ])
    const summary = summarize(timeline)
    expect(summary.text).toBe('answer')
    expect(summary.reasoning).toBe('think')
    expect(summary.tools).toEqual(['read'])
    expect(summary.frames).toBe(3)
  })

  it('lists each tool once, in first-seen order', () => {
    const timeline = buildTimeline([
      toolRun({ seq: 1, time: T0, args: ['a'], dt: [], id: 'c1', name: 'write' }),
      toolRun({ seq: 2, time: T0 + 5, args: ['b'], dt: [], id: 'c2', name: 'read' }),
      toolRun({ seq: 3, time: T0 + 10, args: ['c'], dt: [], id: 'c3', name: 'write' }),
    ])
    expect(summarize(timeline).tools).toEqual(['write', 'read'])
  })

  it('summarizes an empty timeline without throwing', () => {
    const summary = summarize(buildTimeline([]))
    expect(summary).toEqual({ frames: 0, totalMs: 0, text: '', reasoning: '', tools: [] })
  })
})

describe('real production storage format', () => {
  // These guard bugs found only by running against a real 5,776-event
  // production log on a live dsh server (0.1.1-rc.2): packed storage rows name
  // their coordinates `seq0`/`time0`, and the first line is a SessionHeader
  // that must not consume a sequence. Reading the source alone did not reveal
  // either — the wire type uses `seq`/`time`, the storage type does not.
  it('reads seq0/time0 from a packed storage row', () => {
    const log = '{"type":"text-chunks","seq0":42,"time0":1700,"data":{"turn":1,"step":1,"index":0,"dt":[7],"texts":["a","b"]}}'
    const parsed = parseSessionLog(log)
    expect(parsed.synthesizedTimes).toBe(false)
    const record = parsed.records[0]
    expect(record?.type === 'chunks' && record.event.seq).toBe(42)
    expect(record?.type === 'chunks' && record.event.time).toBe(1700)
  })

  it('keeps the SessionHeader out of records and out of the sequence space', () => {
    const log = [
      '{"type":"session","version":0,"id":"abc","createdAt":1786896131629,"cwd":"/w","delegationDepth":0}',
      '{"type":"permission/preset","seq":0,"time":100,"data":{"preset":"x"}}',
    ].join('\n')
    const parsed = parseSessionLog(log)
    expect(parsed.records).toHaveLength(1)
    expect(parsed.records[0]?.event.seq).toBe(0)
    expect(parsed.header?.['id']).toBe('abc')
  })

  it('does not claim synthetic times for a log that has real ones', () => {
    const log = [
      '{"type":"session","version":0,"id":"a","createdAt":1,"cwd":"/w"}',
      '{"type":"turn/start","seq":0,"time":1000,"data":{"turn":1}}',
      '{"type":"text-chunks","seq0":1,"time0":1105,"data":{"turn":1,"step":1,"index":0,"dt":[0,0],"texts":["x","y","z"]}}',
    ].join('\n')
    const parsed = parseSessionLog(log)
    expect(parsed.synthesizedTimes).toBe(false)
    const timeline = buildTimeline(parsed.records, { maxGapMs: Infinity })
    // The 105ms first-token latency must survive verbatim.
    expect(timeline.frames.map(frame => frame.atMs)).toEqual([0, 105, 105, 105])
  })

  it('still treats a genuinely timestamp-free log as synthetic', () => {
    expect(parseSessionLog('{"type":"turn/start"}').synthesizedTimes).toBe(true)
  })
})

describe('minGapMs (real dt distribution is median 0ms)', () => {
  it('floors zero-length gaps so tokens are visible', () => {
    const timeline = buildTimeline(
      [textRun({ seq: 1, time: T0, texts: ['a', 'b', 'c'], dt: [0, 0] })],
      { minGapMs: 10 },
    )
    expect(timeline.frames.map(frame => frame.atMs)).toEqual([0, 10, 20])
  })

  it('leaves a genuinely long gap long', () => {
    const timeline = buildTimeline(
      [textRun({ seq: 1, time: T0, texts: ['a', 'b'], dt: [400] })],
      { minGapMs: 10, maxGapMs: 2000 },
    )
    expect(timeline.totalMs).toBe(400)
  })

  it('does not report a floored gap as compressed', () => {
    const timeline = buildTimeline(
      [textRun({ seq: 1, time: T0, texts: ['a', 'b'], dt: [0] })],
      { minGapMs: 10 },
    )
    expect(timeline.compressedGaps).toBe(0)
  })

  it('lets the ceiling win when the floor would exceed it', () => {
    const timeline = buildTimeline(
      [textRun({ seq: 1, time: T0, texts: ['a', 'b'], dt: [0] })],
      { minGapMs: 500, maxGapMs: 100 },
    )
    expect(timeline.totalMs).toBe(100)
  })

  it('is verbatim by default', () => {
    const timeline = buildTimeline([textRun({ seq: 1, time: T0, texts: ['a', 'b'], dt: [0] })])
    expect(timeline.totalMs).toBe(0)
  })

  it('ignores a negative floor', () => {
    const timeline = buildTimeline(
      [textRun({ seq: 1, time: T0, texts: ['a', 'b'], dt: [5] })],
      { minGapMs: -100 },
    )
    expect(timeline.totalMs).toBe(5)
  })
})
