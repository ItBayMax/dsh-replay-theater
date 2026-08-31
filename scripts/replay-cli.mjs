#!/usr/bin/env node
// Replay a recorded session.jsonl in the terminal, or compare two of them.
//
// This exists because the theater's core is framework-free: the same functions
// the browser tab uses work in a script, which is how the offline half was
// verified end to end.
//
// Usage:
//   node scripts/replay-cli.mjs <session.jsonl> [--frames N] [--max-gap MS]
//   node scripts/replay-cli.mjs <a.jsonl> <b.jsonl>          # compare
import { readFileSync } from 'node:fs'
import { buildTimeline, findDivergence, parseSessionLog, summarize } from '../lib/index.js'

const args = process.argv.slice(2)

// Collect flags first so their VALUES are not mistaken for file names.
const flags = new Map()
const files = []
for (let i = 0; i < args.length; i += 1) {
  const arg = args[i]
  if (arg.startsWith('--')) {
    flags.set(arg.slice(2), Number(args[i + 1]))
    i += 1
    continue
  }
  files.push(arg)
}
const flag = (name, fallback) => (flags.has(name) ? flags.get(name) : fallback)

if (files.length === 0) {
  console.error('usage: replay-cli.mjs <session.jsonl> [b.jsonl] [--frames N] [--max-gap MS]')
  process.exit(2)
}

const maxGapMs = flag('max-gap', 2000)
const load = (file) => {
  const parsed = parseSessionLog(readFileSync(file, 'utf8'))
  return { file, parsed, timeline: buildTimeline(parsed.records, { maxGapMs }) }
}

const left = load(files[0])
console.log(`${left.file}`)
console.log(`  records ${left.parsed.records.length}, skipped ${left.parsed.skipped.length}, synthetic times ${left.parsed.synthesizedTimes}`)
console.log(`  frames ${left.timeline.frames.length}, ${left.timeline.totalMs}ms, compressed ${left.timeline.compressedGaps} gaps`)
const summary = summarize(left.timeline)
console.log(`  text ${summary.text.length} chars, reasoning ${summary.reasoning.length} chars, tools [${summary.tools.join(', ')}]`)

if (files.length > 1) {
  const right = load(files[1])
  console.log(`\n${right.file}`)
  console.log(`  frames ${right.timeline.frames.length}, ${right.timeline.totalMs}ms`)
  const divergence = findDivergence(left.timeline, right.timeline)
  console.log('\ncomparison:', divergence.kind === 'identical'
    ? `identical over ${divergence.comparedFrames} frames`
    : `diverged at frame ${divergence.atFrame} (${divergence.reason}), left seq ${divergence.leftSeq ?? '-'} / right seq ${divergence.rightSeq ?? '-'}`)
  process.exit(0)
}

const limit = flag('frames', 15)
console.log(`\nfirst ${limit} frames:`)
for (const frame of left.timeline.frames.slice(0, limit)) {
  const label = frame.payload.kind === 'marker'
    ? `[${frame.payload.event.type}]`
    : `${frame.payload.kind}: ${JSON.stringify(frame.payload.text.slice(0, 48))}`
  console.log(`  ${String(frame.atMs).padStart(6)}ms seq=${String(frame.seq).padStart(4)} ${label}`)
}
