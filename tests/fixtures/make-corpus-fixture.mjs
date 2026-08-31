// Derive a test fixture from an upstream recorded-session snapshot.
//
// Why derived rather than copied: the upstream snapshot corpus is normalized for
// stable diffing, which strips `seq` and `time` from every event (see
// snapshots/AGENTS.md — "Replace volatile identities with typed
// relationship-preserving tokens"). A replay theater needs both, so this script
// assigns sequential `seq` and synthesizes plausible `time` values, and packs
// consecutive same-block assistant deltas into `chunks` records the way the
// real wire transport does.
//
// The point of the derived fixture is to prove our wire mirror accepts the
// SHAPES real sessions produce. Cadence assertions use hand-built fixtures with
// exact `dt` arrays instead.
//
// Usage: node tests/fixtures/make-corpus-fixture.mjs <path-to-session.jsonl> > out.json
import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'

const source = process.argv[2]
if (source === undefined) {
  console.error('usage: make-corpus-fixture.mjs <session.jsonl>')
  process.exit(2)
}

/** Synthetic inter-event gap in ms; varied so packed runs carry non-uniform dt. */
const GAPS = [18, 24, 31, 12, 47, 21, 15, 63, 28, 19]

/**
 * Minimum members for a packed run in THIS derivation.
 *
 * Upstream packs at 3+ (MIN_RUN, chunk-rows.ts:99). The corpus is recorded
 * against replayed/mock model responses, so its streams are extremely short —
 * the richest snapshot holds 3 `text-delta` events total. Packing at 2 here
 * yields at least some `chunks` records so the fixture exercises BOTH record
 * shapes, which is the whole point of a shape-compatibility fixture.
 */
const MIN_PACK = 2

const lines = createInterface({ input: createReadStream(source, 'utf8'), crlfDelay: Infinity })

/** @type {{type: string, seq: number, time: number, data?: unknown}[]} */
const events = []
let seq = 0
let time = 1_760_000_000_000
let gapIndex = 0
for await (const line of lines) {
  const text = line.trim()
  if (text === '') continue
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    continue
  }
  if (typeof parsed !== 'object' || parsed === null) continue
  const gap = GAPS[gapIndex % GAPS.length]
  gapIndex += 1
  time += gap
  seq += 1
  events.push({ ...parsed, seq, time })
}

// Pack consecutive assistant/chunk deltas that share (turn, step, block, kind),
// mirroring the run-packing rule at packages/core/session/src/chunk-rows.ts.

/** @type {unknown[]} */
const records = []
let run = null

const flush = () => {
  if (run === null) return
  if (run.members.length >= MIN_PACK) {
    const dt = []
    for (let i = 1; i < run.times.length; i += 1) dt.push(run.times[i] - run.times[i - 1])
    const data = { turn: run.turn, step: run.step, index: run.index, dt }
    if (run.kind === 'tool-call-chunks') {
      records.push({
        type: 'chunks',
        event: {
          type: 'chunkrow/tool-call-chunks',
          seq: run.seq0,
          time: run.times[0],
          data: { ...data, id: run.id, ...run.name === undefined ? {} : { name: run.name }, args: run.members },
        },
      })
    } else {
      records.push({
        type: 'chunks',
        event: {
          type: `chunkrow/${run.kind}`,
          seq: run.seq0,
          time: run.times[0],
          data: { ...data, texts: run.members },
        },
      })
    }
  } else {
    for (const scalar of run.scalars) records.push({ type: 'event', event: scalar })
  }
  run = null
}

const deltaKind = (chunk) => {
  if (chunk.type === 'text-delta') return 'text-chunks'
  if (chunk.type === 'reasoning-delta') return 'reasoning-chunks'
  if (chunk.type === 'tool-call-delta') return 'tool-call-chunks'
  return undefined
}

const deltaText = (chunk) =>
  chunk.type === 'tool-call-delta' ? (chunk.argumentsDelta ?? '') : (chunk.text ?? '')

for (const event of events) {
  const chunk = event.type === 'assistant/chunk' ? event.data?.chunk : undefined
  const kind = chunk === undefined ? undefined : deltaKind(chunk)
  if (kind === undefined) {
    flush()
    records.push({ type: 'event', event })
    continue
  }
  const turn = event.data.turn
  const step = event.data.step
  const index = chunk.index
  const id = chunk.id
  const continues = run !== null
    && run.kind === kind && run.turn === turn && run.step === step
    && run.index === index && run.id === id
    && event.seq === run.seq0 + run.members.length
  if (!continues) {
    flush()
    run = {
      kind, turn, step, index, id, name: chunk.name,
      seq0: event.seq, members: [], times: [], scalars: [],
    }
  }
  run.members.push(deltaText(chunk))
  run.times.push(event.time)
  run.scalars.push(event)
}
flush()

process.stdout.write(`${JSON.stringify({
  source,
  note: 'Derived from an upstream snapshot; seq/time synthesized (the corpus normalizes them away).',
  records,
}, null, 1)}\n`)
