/**
 * Plugin registration and locale integrity.
 *
 * These guard the two things a broken plugin fails at silently: registering on
 * the wrong slot, and shipping a dictionary that is missing a key in one
 * language (dsh 0.1.2 makes dictionary parity a hard rule).
 *
 * @module dsh-replay-theater/tests/plugin
 */

import { describe, expect, it, vi } from 'vitest'
import { apply as applyClient, inject, name } from '../src/client/index.ts'
import { apply as applyHost, name as hostName } from '../src/host.ts'
import type { ClientSession, TheaterClientContext, ViewSlotOptions } from '../src/client/dsh.ts'
import { en, format, NS, zh } from '../src/client/locales.ts'
import { GAP_CHOICES } from '../src/client/TheaterView.tsx'
import { SPEEDS } from '../src/core/player.ts'

/** A recording stand-in for the client context. */
function fakeContext(session?: ClientSession): {
  ctx: TheaterClientContext
  registrations: ViewSlotOptions<object>[]
  injectedSlots: string[]
  dictionaries: Record<string, unknown>
  effects: string[]
} {
  const registrations: ViewSlotOptions<object>[] = []
  const injectedSlots: string[] = []
  const dictionaries: Record<string, unknown> = {}
  const effects: string[] = []
  return {
    registrations,
    injectedSlots,
    dictionaries,
    effects,
    ctx: {
      effect: (fn, label) => {
        effects.push(label ?? '')
        fn()
      },
      locale: {
        register: (namespace, dicts) => {
          dictionaries[namespace] = dicts
          return () => {}
        },
        translate: (_namespace, key) => `t:${key}`,
      },
      slots: {
        inject: (slotName, fn) => {
          injectedSlots.push(slotName)
          fn()
        },
        register: (options) => {
          registrations.push(options as ViewSlotOptions<object>)
        },
      },
      sessions: {
        binding: () => (session === undefined ? undefined : { session }),
      },
    },
  }
}

/** A minimal session stand-in. */
const stubSession: ClientSession = {
  eventSource: {
    getSnapshot: () => ({ entries: [], hasMore: false, revision: 1 }),
    subscribe: () => () => {},
  },
  loadOlder: async () => {},
}

describe('client plugin', () => {
  it('declares the services it needs', () => {
    expect(inject).toEqual(['slots', 'locale', 'sessions'])
  })

  it('has a loader-visible name', () => {
    expect(name).toBe('dsh-replay-theater/client')
  })

  it('registers dictionaries through an effect so unload removes them', () => {
    const { ctx, dictionaries, effects } = fakeContext(stubSession)
    applyClient(ctx)
    expect(dictionaries[NS]).toEqual({ zh, en })
    expect(effects).toContain('replay-theater: dictionaries')
  })

  it('registers on the conversation.view slot', () => {
    const { ctx, injectedSlots, registrations } = fakeContext(stubSession)
    applyClient(ctx)
    expect(injectedSlots).toEqual(['conversation.view'])
    expect(registrations).toHaveLength(1)
    expect(registrations[0]?.name).toBe('conversation.view')
    expect(registrations[0]?.id).toBe('replay-theater')
  })

  it('orders itself after the built-in Chat and Trajectory tabs', () => {
    const { ctx, registrations } = fakeContext(stubSession)
    applyClient(ctx)
    expect(registrations[0]?.order).toBeGreaterThan(10)
  })

  it('takes the tab label from the locale service, not a hardcoded string', () => {
    const { ctx, registrations } = fakeContext(stubSession)
    applyClient(ctx)
    expect(registrations[0]?.label()).toBe('t:view.theater')
  })

  it('injects the session for a known session id', () => {
    const { ctx, registrations } = fakeContext(stubSession)
    applyClient(ctx)
    const injected = registrations[0]?.inject('session-1') as { session: ClientSession }
    expect(injected.session).toBe(stubSession)
  })

  it('fails loudly for an unavailable session instead of rendering an empty tab', () => {
    const { ctx, registrations } = fakeContext(undefined)
    applyClient(ctx)
    expect(() => registrations[0]?.inject('missing')).toThrow(/session "missing" is unavailable/u)
  })

  it('reports whether paging actually added anything', async () => {
    let revision = 1
    const session: ClientSession = {
      eventSource: {
        getSnapshot: () => ({ entries: [], hasMore: true, revision }),
        subscribe: () => () => {},
      },
      loadOlder: async () => {
        revision += 1
      },
    }
    const { ctx, registrations } = fakeContext(session)
    applyClient(ctx)
    const injected = registrations[0]?.inject('s') as { loadOlder: () => Promise<boolean> }
    await expect(injected.loadOlder()).resolves.toBe(true)
  })

  it('reports false when paging added nothing', async () => {
    const { ctx, registrations } = fakeContext(stubSession)
    applyClient(ctx)
    const injected = registrations[0]?.inject('s') as { loadOlder: () => Promise<boolean> }
    await expect(injected.loadOlder()).resolves.toBe(false)
  })
})

describe('host plugin', () => {
  it('exposes a loader-visible name', () => {
    expect(hostName).toBe('dsh-replay-theater')
  })

  it('registers nothing, because the feature is browser-only', () => {
    expect(() => applyHost()).not.toThrow()
  })
})

describe('locale dictionaries', () => {
  it('has identical key sets in both languages', () => {
    expect(Object.keys(zh).sort()).toEqual(Object.keys(en).sort())
  })

  it('has no empty values', () => {
    for (const [key, value] of Object.entries({ ...en, ...zh })) {
      expect(value, key).not.toBe('')
    }
  })

  it('keeps placeholder sets aligned between languages', () => {
    const placeholders = (text: string): string[] =>
      [...text.matchAll(/\{(\w+)\}/gu)].map(match => match[1] ?? '').sort()
    for (const key of Object.keys(en) as (keyof typeof en)[]) {
      expect(placeholders(zh[key]), key).toEqual(placeholders(en[key]))
    }
  })

  it('fills placeholders', () => {
    expect(format('{a} and {b}', { a: 1, b: 'two' })).toBe('1 and two')
  })

  it('leaves an unmatched placeholder verbatim rather than printing undefined', () => {
    expect(format('{missing}', {})).toBe('{missing}')
  })
})

describe('offered choices', () => {
  it('offers speeds spanning slower and faster than real time', () => {
    expect(SPEEDS[0]).toBeLessThan(1)
    expect(SPEEDS[SPEEDS.length - 1]).toBeGreaterThan(1)
  })

  it('offers a true-cadence pause ceiling', () => {
    expect(GAP_CHOICES).toContain(Infinity)
  })

  it('keeps pause ceilings ascending', () => {
    const values = [...GAP_CHOICES]
    expect(values).toEqual([...values].sort((left, right) => left - right))
  })
})
