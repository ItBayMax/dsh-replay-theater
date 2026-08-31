/**
 * P0 placeholder view. Replaced by the real stage in P2.
 *
 * @module dsh-replay-theater/client/TheaterView
 */

import type { TheaterInjected } from './dsh.ts'
import { en } from './locales.ts'

/** Props the slot runtime composes for this view. */
export type TheaterViewProps = TheaterInjected

/**
 * Render the theater tab.
 * @param props - the injected session face.
 * @returns the placeholder stage.
 */
export function TheaterView(props: TheaterViewProps): JSX.Element {
  const window = props.session.eventSource.getSnapshot()
  return (
    <div>
      <p>{en['view.theater']}</p>
      <p>{`${window.entries.length} records in window`}</p>
    </div>
  )
}
