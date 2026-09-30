/**
 * Minimal structural mirror of the dsh client APIs this plugin consumes.
 *
 * Why a mirror instead of `import type` from `@deepseek-ai/*`:
 * `@deepseek-ai/dsh-api-session-controller` and the `ui-*` client packages that
 * declare these faces are NOT published to npm. Mirroring keeps this package
 * installable and testable standalone. Every declaration below is structurally
 * compatible with upstream at commit 639ed01 (dsh@0.2.0-rc.2) and records where
 * it was read from, so a future version can replace this file with real imports
 * without touching a single call site.
 *
 * @module dsh-replay-theater/client/dsh
 */

import type { HistoryRecord } from '../core/wire.ts'

/**
 * A React-free observable snapshot.
 *
 * Mirrors `ObservableSnapshot` — packages/client/store/src/contract.ts.
 */
export interface ObservableSnapshot<T> {
  getSnapshot: () => T
  subscribe: (listener: () => void) => () => void
}

/**
 * One materialized window of session history plus the live tail.
 *
 * Mirrors `SessionEventWindow` —
 * packages/api/session-controller/src/client/contract/events.ts:109-114.
 * `entries` are aligned wire records whose OUTER `type` is the only safe
 * discriminator: `'event'` for a durable event, `'transient'` for a client-only
 * live assistant frame that a later settlement replaces atomically.
 *
 * Upstream also publishes a `change` field on this window describing what the
 * last mutation did. The theater rebuilds from `entries` and does not read it,
 * so it is omitted here rather than mirrored inaccurately.
 */
export interface SessionEventWindow {
  readonly entries: readonly HistoryRecord[]
  readonly hasMore: boolean
  readonly revision: number
}

/**
 * Conversation-facing event source of one session binding.
 *
 * Mirrors `SessionEventSource` — same file, `:92`.
 */
export type SessionEventSource = ObservableSnapshot<SessionEventWindow>

/**
 * The client-side session object the theater needs.
 *
 * Mirrors the public surface of `ClientSession` —
 * packages/api/session-controller/src/client/sessions/session.ts:125 (`eventSource`)
 * and `:351` (`loadOlder`). Paging is backwards-only and message-aligned;
 * there is no "read from seq 0" call, which is why the theater plays the
 * loaded window and offers an explicit "load earlier" action.
 */
export interface ClientSession {
  readonly eventSource: SessionEventSource
  loadOlder: () => Promise<void>
}

/** Session id, opaque to this package. */
export type SessionId = string

/** What the theater view receives from its slot registration's `inject`. */
export interface TheaterInjected {
  /** The session being replayed. */
  readonly session: ClientSession
  /**
   * Page one older window in, resolving to whether anything was added.
   * Mirrors the shape `ui-trajectory` uses for the same purpose.
   */
  loadOlder: () => Promise<boolean>
}

/** Translation function for this plugin's namespace. */
export type Translate = (key: string, values?: Readonly<Record<string, string | number>>) => string

/**
 * Slot registration options, narrowed to what a `conversation.view` entry uses.
 *
 * Mirrors the options object passed to `ctx.slots.register` at
 * packages/client/ui-trajectory/src/client/index.ts:77-106.
 */
export interface ViewSlotOptions<I extends object> {
  readonly name: 'conversation.view'
  readonly id: string
  readonly order: number
  readonly locale: string
  /** Tab label — must come from a dictionary (0.1.2 locale-ownership rule). */
  label: () => string
  inject: (sessionId: SessionId) => I
}

/** The client context faces this plugin injects. */
export interface TheaterClientContext {
  effect: (fn: () => (() => void) | void, label?: string) => void
  locale: {
    register: (namespace: string, dictionaries: Readonly<Record<string, Readonly<Record<string, string>>>>) => () => void
    /** Resolve one dictionary key outside a component (used for the tab label). */
    translate: (namespace: string, key: string) => string
  }
  slots: {
    inject: (name: string, fn: () => void) => void
    register: <I extends object>(options: ViewSlotOptions<I>, component: unknown) => void
  }
  sessions: {
    binding: (sessionId: SessionId) => { readonly session: ClientSession } | undefined
  }
}
