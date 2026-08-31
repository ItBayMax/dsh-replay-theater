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
export type {
  ChunkRowEvent,
  HistoryRecord,
  ScalarEvent,
  TextRunData,
  ToolCallRunData,
} from './core/wire.ts'
