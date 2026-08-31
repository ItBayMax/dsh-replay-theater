/**
 * Host half of the replay theater.
 *
 * The theater is a browser-only feature: it reads the session history window
 * the client already holds and renders it. The host half exists so the package
 * is a well-formed dsh bundle (a `dsh.client` row still needs a mountable
 * plugin), and it deliberately registers nothing.
 *
 * @module dsh-replay-theater/host
 */

/** Loader-visible plugin name. */
export const name = 'dsh-replay-theater'

/**
 * Mount the host half.
 *
 * Intentionally empty: no service, no event, no tool. Everything the theater
 * needs is already on the client (`session.eventSource`), so adding a host
 * registration here would create a dependency the feature does not have.
 */
export function apply(): void {
  // Nothing to register — see the module docstring.
}
