// @vitest-environment jsdom
/**
 * Component behavior: the stage grows as playback advances, the transport bar
 * drives the machine, and the empty window states its own emptiness.
 *
 * @module dsh-replay-theater/tests/view
 */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ClientSession, SessionEventWindow } from '../src/client/dsh.ts'
import { TheaterView } from '../src/client/TheaterView.tsx'
import { formatPosition } from '../src/client/TheaterControls.tsx'
import type { HistoryRecord } from '../src/core/wire.ts'
import { en } from '../src/client/locales.ts'
import { scalar, T0, textRun } from './fixtures/synthetic.ts'

/** Translate with the English dictionary, mirroring the slot runtime's `t`. */
const t = (key: string, values?: Readonly<Record<string, string | number>>): string => {
  const template = (en as Record<string, string>)[key] ?? key
  return values === undefined
    ? template
    : template.replace(/\{(\w+)\}/gu, (whole, name: string) => String(values[name] ?? whole))
}

/** A controllable stand-in for one client session binding. */
function fakeSession(records: readonly HistoryRecord[], hasMore = false): {
  session: ClientSession
  push: (extra: readonly HistoryRecord[]) => void
  loadOlderCalls: () => number
} {
  let window: SessionEventWindow = { entries: records, hasMore, revision: 1 }
  const listeners = new Set<() => void>()
  let calls = 0
  return {
    session: {
      eventSource: {
        getSnapshot: () => window,
        subscribe: (listener: () => void) => {
          listeners.add(listener)
          return () => listeners.delete(listener)
        },
      },
      loadOlder: async () => {
        calls += 1
      },
    },
    push: (extra) => {
      window = {
        entries: [...window.entries, ...extra],
        hasMore: window.hasMore,
        revision: window.revision + 1,
      }
      for (const listener of listeners) listener()
    },
    loadOlderCalls: () => calls,
  }
}

/** Three text frames at 0 / 100 / 200 ms. */
const threeFrames: readonly HistoryRecord[] = [
  textRun({ seq: 1, time: T0, texts: ['Hel', 'lo ', 'world'], dt: [100, 100] }),
]

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('TheaterView', () => {
  it('renders the transport bar and stage for a replayable window', () => {
    const { session } = fakeSession(threeFrames)
    render(<TheaterView session={session} loadOlder={async () => true} t={t} />)
    expect(screen.getByTestId('theater-controls')).toBeDefined()
    expect(screen.getByTestId('theater-stage')).toBeDefined()
  })

  it('starts at the first frame, showing only the first token', () => {
    const { session } = fakeSession(threeFrames)
    render(<TheaterView session={session} loadOlder={async () => true} t={t} />)
    expect(screen.getByTestId('theater-stage').textContent).toBe('Hel')
  })

  it('grows the text when stepping forward', () => {
    const { session } = fakeSession(threeFrames)
    render(<TheaterView session={session} loadOlder={async () => true} t={t} />)
    fireEvent.click(screen.getByLabelText(en['control.stepForward']))
    expect(screen.getByTestId('theater-stage').textContent).toBe('Hello ')
    fireEvent.click(screen.getByLabelText(en['control.stepForward']))
    expect(screen.getByTestId('theater-stage').textContent).toBe('Hello world')
  })

  it('shrinks the text when stepping back', () => {
    const { session } = fakeSession(threeFrames)
    render(<TheaterView session={session} loadOlder={async () => true} t={t} />)
    fireEvent.click(screen.getByLabelText(en['control.stepForward']))
    fireEvent.click(screen.getByLabelText(en['control.stepBack']))
    expect(screen.getByTestId('theater-stage').textContent).toBe('Hel')
  })

  it('seeks to an absolute position with the scrub bar', () => {
    const { session } = fakeSession(threeFrames)
    render(<TheaterView session={session} loadOlder={async () => true} t={t} />)
    fireEvent.change(screen.getByTestId('theater-scrub'), { target: { value: '200' } })
    expect(screen.getByTestId('theater-stage').textContent).toBe('Hello world')
  })

  it('toggles the play button label between play and pause', () => {
    const { session } = fakeSession(threeFrames)
    render(<TheaterView session={session} loadOlder={async () => true} t={t} />)
    const toggle = screen.getByTestId('theater-toggle')
    expect(toggle.getAttribute('aria-label')).toBe(en['control.play'])
    fireEvent.click(toggle)
    expect(screen.getByTestId('theater-toggle').getAttribute('aria-label')).toBe(en['control.pause'])
  })

  it('returns to the first frame on restart', () => {
    const { session } = fakeSession(threeFrames)
    render(<TheaterView session={session} loadOlder={async () => true} t={t} />)
    fireEvent.change(screen.getByTestId('theater-scrub'), { target: { value: '200' } })
    fireEvent.click(screen.getByLabelText(en['control.restart']))
    expect(screen.getByTestId('theater-stage').textContent).toBe('Hel')
  })

  it('offers the speeds the core declares', () => {
    const { session } = fakeSession(threeFrames)
    render(<TheaterView session={session} loadOlder={async () => true} t={t} />)
    const options = [...screen.getByTestId('theater-speed').querySelectorAll('option')]
    expect(options.map(option => option.getAttribute('value'))).toEqual(['0.5', '1', '2', '4', '8'])
  })

  it('states its emptiness for a window with nothing replayable', () => {
    const { session } = fakeSession([])
    render(<TheaterView session={session} loadOlder={async () => true} t={t} />)
    expect(screen.getByText(en['stage.empty'])).toBeDefined()
    expect(screen.queryByTestId('theater-stage')).toBeNull()
  })

  it('disables the transport for an empty timeline', () => {
    const { session } = fakeSession([])
    render(<TheaterView session={session} loadOlder={async () => true} t={t} />)
    expect(screen.getByTestId('theater-toggle').hasAttribute('disabled')).toBe(true)
  })

  it('reports compressed silence instead of hiding it', () => {
    const { session } = fakeSession([
      textRun({ seq: 1, time: T0, texts: ['a', 'b'], dt: [60_000] }),
    ])
    render(<TheaterView session={session} loadOlder={async () => true} t={t} maxGapMs={500} />)
    expect(screen.getByTestId('theater-compressed').textContent).toContain('59500')
  })

  it('omits the compression notice when nothing was compressed', () => {
    const { session } = fakeSession(threeFrames)
    render(<TheaterView session={session} loadOlder={async () => true} t={t} maxGapMs={Infinity} />)
    expect(screen.queryByTestId('theater-compressed')).toBeNull()
  })

  it('shows the load-older action only when the window has more history', () => {
    const withMore = fakeSession(threeFrames, true)
    render(<TheaterView session={withMore.session} loadOlder={async () => true} t={t} />)
    expect(screen.getByTestId('theater-load-older')).toBeDefined()
    cleanup()
    const withoutMore = fakeSession(threeFrames, false)
    render(<TheaterView session={withoutMore.session} loadOlder={async () => true} t={t} />)
    expect(screen.queryByTestId('theater-load-older')).toBeNull()
  })

  it('calls the injected pager when loading older history', async () => {
    const { session } = fakeSession(threeFrames, true)
    let called = 0
    render(<TheaterView
      session={session}
      loadOlder={async () => {
        called += 1
        return true
      }}
      t={t}
    />)
    await act(async () => {
      fireEvent.click(screen.getByTestId('theater-load-older'))
    })
    expect(called).toBe(1)
  })

  it('keeps the playhead when the window grows', () => {
    const controlled = fakeSession(threeFrames)
    render(<TheaterView session={controlled.session} loadOlder={async () => true} t={t} />)
    fireEvent.click(screen.getByLabelText(en['control.stepForward']))
    expect(screen.getByTestId('theater-stage').textContent).toBe('Hello ')
    act(() => {
      controlled.push([textRun({ seq: 4, time: T0 + 500, texts: ['!'], dt: [], block: 1 })])
    })
    // Same playhead, so the same text — the appended frame is not shown yet.
    expect(screen.getByTestId('theater-stage').textContent).toBe('Hello ')
  })

  it('advances the stage over real animation frames while playing', async () => {
    const { session } = fakeSession(threeFrames)
    render(<TheaterView session={session} loadOlder={async () => true} t={t} />)
    fireEvent.click(screen.getByTestId('theater-toggle'))
    // Let a few frames elapse; jsdom drives rAF from real timers.
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 300))
    })
    expect(screen.getByTestId('theater-stage').textContent).toBe('Hello world')
  })

  it('changes the pause ceiling from the transport bar', () => {
    const { session } = fakeSession([
      textRun({ seq: 1, time: T0, texts: ['a', 'b'], dt: [10_000] }),
    ])
    render(<TheaterView session={session} loadOlder={async () => true} t={t} maxGapMs={5000} />)
    // At a 5s ceiling the 10s gap is compressed by 5s.
    expect(screen.getByTestId('theater-compressed').textContent).toContain('5000')
    fireEvent.change(screen.getByTestId('theater-gap'), { target: { value: '200' } })
    // Tightening to 200ms compresses 9800ms instead.
    expect(screen.getByTestId('theater-compressed').textContent).toContain('9800')
  })

  it('drops the compression notice when the ceiling is set to true cadence', () => {
    const { session } = fakeSession([
      textRun({ seq: 1, time: T0, texts: ['a', 'b'], dt: [10_000] }),
    ])
    render(<TheaterView session={session} loadOlder={async () => true} t={t} maxGapMs={500} />)
    expect(screen.getByTestId('theater-compressed')).toBeDefined()
    fireEvent.change(screen.getByTestId('theater-gap'), { target: { value: 'Infinity' } })
    expect(screen.queryByTestId('theater-compressed')).toBeNull()
  })

  it('renders scalar events as markers', () => {
    const { session } = fakeSession([
      scalar({ type: 'step/start', seq: 1, time: T0 }),
      textRun({ seq: 2, time: T0 + 10, texts: ['hi'], dt: [] }),
    ])
    render(<TheaterView session={session} loadOlder={async () => true} t={t} />)
    expect(screen.getByTestId('theater-markers').textContent).toContain('step/start')
  })
})

describe('formatPosition', () => {
  it('formats sub-second, second and minute positions', () => {
    expect(formatPosition(0)).toBe('0:00.0')
    expect(formatPosition(1_500)).toBe('0:01.5')
    expect(formatPosition(65_400)).toBe('1:05.4')
  })

  it('clamps a negative position', () => {
    expect(formatPosition(-10)).toBe('0:00.0')
  })
})
