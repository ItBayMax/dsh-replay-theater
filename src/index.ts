/**
 * Package root: the host-half plugin plus the types a consumer may want.
 *
 * The browser half lives at the `./client` subpath (loaded by the dsh client
 * module system from the `dsh.client` manifest row), and the framework-free
 * replay core at `./timeline` for anyone who wants to build a timeline outside
 * a browser (offline tooling, tests, evaluation reports).
 *
 * @module dsh-replay-theater
 */

export { apply, name } from './host.ts'

// The replay core is the reusable half: a future evaluation plugin can build
// timelines and compare runs without mounting any UI.
export {
  buildTimeline,
  DEFAULT_MAX_GAP_MS,
  frameIndexAt,
  stageAt,
} from './core/timeline.ts'
export type { Frame, FramePayload, StageBlock, StageState, Timeline, TimelineOptions } from './core/timeline.ts'
export { findDivergence, summarize } from './core/compare.ts'
export type { Divergence, SideSummary } from './core/compare.ts'
export { parseSessionLog } from './core/jsonl.ts'
export type { ParsedLog } from './core/jsonl.ts'
export type {
  ChunkRowEvent,
  HistoryRecord,
  ScalarEvent,
  TextRunData,
  ToolCallRunData,
} from './core/wire.ts'
