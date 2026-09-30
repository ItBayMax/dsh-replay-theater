// Derive the corpus test fixture from an upstream recorded session snapshot.
//
// Why a derived fixture instead of reading the snapshot directly in the test:
// the harness checkout is not a dependency of this package, so CI (and anyone
// who clones just this repo) must still be able to run the suite. The fixture
// is committed; this script documents and reproduces how it was made.
//
// The snapshot corpus normalizes `seq` and `time` away (upstream records them
// as placeholders so replays diff cleanly), so this script re-adds them:
// line order becomes the sequence, and a uniform synthetic clock becomes the
// time. That is enough for the fixture's purpose — proving the wire mirror
// accepts the SHAPES real sessions produce — and deliberately not enough to
// carry cadence assertions, which live in tests/fixtures/synthetic.ts instead.
//
// Usage: node scripts/make-corpus-fixture.mjs [path/to/session.vN.jsonl]

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const DEFAULT_SOURCE = new URL(
  '../../../deepseek-harness/snapshots/acp/escalation-approved/session.v3.jsonl',
  import.meta.url,
)
const OUT = new URL('../tests/fixtures/corpus-escalation-approved.json', import.meta.url)

/** Milliseconds added per record by the synthetic clock. */
const SYNTHETIC_GAP_MS = 30
/** Base epoch, chosen to be obviously synthetic rather than plausibly real. */
const T0 = 1_760_000_000_000

const sourceArg = process.argv[2]
const source = sourceArg === undefined ? DEFAULT_SOURCE : new URL(`file://${sourceArg}`)

const text = readFileSync(fileURLToPath(source), 'utf8')
const records = []
let seq = 0
let clock = T0

for (const line of text.split(/\r?\n/u)) {
  const trimmed = line.trim()
  if (trimmed === '') continue
  const parsed = JSON.parse(trimmed)
  // The session header is metadata, not an event: it carries no sequence and
  // must not consume one.
  if (parsed.type === 'session' && parsed.seq === undefined && parsed.id !== undefined) continue

  const event = {
    ...parsed,
    seq: typeof parsed.seq === 'number' ? parsed.seq : seq,
    time: typeof parsed.time === 'number' ? parsed.time : clock,
  }
  records.push({ type: 'event', event })
  seq += 1
  clock += SYNTHETIC_GAP_MS
}

const assistantRecords = records.filter(record => Array.isArray(record.event.data?.stream))
const streamMembers = assistantRecords.reduce((total, record) => total + record.event.data.stream.length, 0)

writeFileSync(fileURLToPath(OUT), `${JSON.stringify({
  source: source.pathname.split('/').slice(-4).join('/'),
  note: 'Derived by scripts/make-corpus-fixture.mjs. seq/time are synthetic; shapes are real.',
  records,
}, null, 2)}\n`)

console.log(`${records.length} records (${assistantRecords.length} with an embedded stream, ${streamMembers} stream members) → ${fileURLToPath(OUT)}`)
