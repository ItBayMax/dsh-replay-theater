/**
 * Browser half of the replay theater: one `conversation.view` tab.
 *
 * The registration deliberately does NOT touch `ctx.uiConversation`'s
 * Conversation-target machinery. Upstream's `ui-trajectory` takes a target in
 * its `inject` (index.ts:77-106), but the theater only needs the session
 * itself — `session.eventSource` already carries the aligned history records,
 * so the whole Definition/snapshot-builder layer is unnecessary here. That is
 * the difference between an 11-file plugin and a 27-file one.
 *
 * @module dsh-replay-theater/client
 */

import type { SessionId, TheaterClientContext, TheaterInjected } from './dsh.ts'
import { en, NS, zh } from './locales.ts'
import { TheaterView } from './TheaterView.tsx'

/** Services this plugin needs before it can register anything. */
export const inject = ['slots', 'locale', 'sessions']

/** Loader-visible plugin name for the client module graph. */
export const name = 'dsh-replay-theater/client'

/**
 * Register the dictionaries and the theater view tab.
 * @param ctx - the client context.
 */
export function apply(ctx: TheaterClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'replay-theater: dictionaries')

  ctx.slots.inject('conversation.view', () => {
    ctx.slots.register<TheaterInjected>({
      name: 'conversation.view',
      id: 'replay-theater',
      // After the built-in Chat (0) and Trajectory (10) tabs.
      order: 20,
      locale: NS,
      label: () => en['view.theater'],
      inject: (sessionId: SessionId): TheaterInjected => {
        const session = ctx.sessions.binding(sessionId)?.session
        if (session === undefined) {
          throw new Error(`dsh-replay-theater: session "${sessionId}" is unavailable`)
        }
        return {
          session,
          loadOlder: async () => {
            const before = session.eventSource.getSnapshot().revision
            await session.loadOlder()
            return session.eventSource.getSnapshot().revision !== before
          },
        }
      },
    }, TheaterView)
  })
}
