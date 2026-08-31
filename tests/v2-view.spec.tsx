// @vitest-environment jsdom
/**
 * v2 component behavior: the comparison pane and the offline drop zone.
 *
 * @module dsh-replay-theater/tests/v2-view
 */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { CompareView, describeDivergence } from '../src/client/CompareView.tsx'
import type { ClientSession, SessionEventWindow } from '../src/client/dsh.ts'
import { en } from '../src/client/locales.ts'
import { OfflineDrop } from '../src/client/OfflineDrop.tsx'
import { TheaterView } from '../src/client/TheaterView.tsx'
import { findDivergence } from '../src/core/compare.ts'
import { buildTimeline } from '../src/core/timeline.ts'
import type { HistoryRecord } from '../src/core/wire.ts'
import { T0, textRun } from './fixtures/synthetic.ts'

/** Translate with the English dictionary, mirroring the slot runtime's `t`. */
const t = (key: string, values?: Readonly<Record<string, string | number>>): string => {
  const template = (en as Record<string, string>)[key] ?? key
  return values === undefined
    ? template
    : template.replace(/\{(\w+)\}/gu, (whole, name: string) => String(values[name] ?? whole))
}

/** A minimal session stand-in over a fixed window. */
function fakeSession(records: readonly HistoryRecord[]): ClientSession {
  const window: SessionEventWindow = { entries: records, hasMore: false, revision: 1 }
  return {
    eventSource: { getSnapshot: () => window, subscribe: () => () => {} },
    loadOlder: async () => {},
  }
}

/** Build a File whose `text()` resolves, which jsdom's File does not do by default. */
function logFile(name: string, contents: string): File {
  const file = new File([contents], name, { type: 'text/plain' })
  Object.defineProperty(file, 'text', { value: async () => contents })
  return file
}

const hello = buildTimeline([textRun({ seq: 1, time: T0, texts: ['Hel', 'lo'], dt: [10] })])
const helpMe = buildTimeline([textRun({ seq: 1, time: T0, texts: ['Hel', 'p!'], dt: [10] })])

afterEach(cleanup)

describe('CompareView', () => {
  it('renders both panes with their labels', () => {
    render(<CompareView
      t={t}
      left={{ label: 'run A', timeline: hello }}
      right={{ label: 'run B', timeline: helpMe }}
    />)
    expect(screen.getByTestId('compare-left').textContent).toContain('run A')
    expect(screen.getByTestId('compare-right').textContent).toContain('run B')
  })

  it('names the first divergence', () => {
    render(<CompareView
      t={t}
      left={{ label: 'A', timeline: hello }}
      right={{ label: 'B', timeline: helpMe }}
    />)
    expect(screen.getByTestId('compare-divergence').textContent).toContain('seq 2')
  })

  it('says so when two runs agree', () => {
    render(<CompareView
      t={t}
      left={{ label: 'A', timeline: hello }}
      right={{ label: 'B', timeline: hello }}
    />)
    expect(screen.getByTestId('compare-divergence').textContent).toBe(en['compare.identical'])
  })

  it('shows each side at its end state when neither has a player', () => {
    render(<CompareView
      t={t}
      left={{ label: 'A', timeline: hello }}
      right={{ label: 'B', timeline: helpMe }}
    />)
    expect(screen.getByTestId('compare-left').textContent).toContain('Hello')
    expect(screen.getByTestId('compare-right').textContent).toContain('Help!')
  })

  it('honors an explicit frame index for a static side', () => {
    render(<CompareView
      t={t}
      left={{ label: 'A', timeline: hello, frameIndex: 0 }}
      right={{ label: 'B', timeline: helpMe, frameIndex: 0 }}
    />)
    expect(screen.getByTestId('compare-left').textContent).toContain('Hel')
    expect(screen.getByTestId('compare-left').textContent).not.toContain('Hello')
  })

  it('reports each side frame count', () => {
    render(<CompareView
      t={t}
      left={{ label: 'A', timeline: hello }}
      right={{ label: 'B', timeline: helpMe }}
    />)
    expect(screen.getByTestId('compare-left').textContent).toContain('2 frames')
  })

  it('offers no jump button when there is nothing to jump to', () => {
    render(<CompareView
      t={t}
      left={{ label: 'A', timeline: hello }}
      right={{ label: 'B', timeline: hello }}
    />)
    expect(screen.queryByTestId('compare-jump')).toBeNull()
  })
})

describe('describeDivergence', () => {
  it('describes an identical pair', () => {
    expect(describeDivergence(findDivergence(hello, hello), t)).toBe(en['compare.identical'])
  })

  it('describes a divergence with its sequence', () => {
    expect(describeDivergence(findDivergence(hello, helpMe), t)).toContain('seq 2')
  })
})

describe('OfflineDrop', () => {
  it('parses a chosen log and reports it', async () => {
    let loaded: { name: string; records: readonly HistoryRecord[] } | undefined
    render(<OfflineDrop t={t} onLoad={log => { loaded = log }} />)
    const log = ['{"type":"turn/start","seq":1,"time":0}', '{"type":"step/start","seq":2,"time":10}'].join('\n')
    await act(async () => {
      fireEvent.change(screen.getByTestId('offline-input'), {
        target: { files: [logFile('session.jsonl', log)] },
      })
    })
    expect(loaded?.name).toBe('session.jsonl')
    expect(loaded?.records).toHaveLength(2)
  })

  it('reports a file that is not a session log', async () => {
    let called = 0
    render(<OfflineDrop t={t} onLoad={() => { called += 1 }} />)
    await act(async () => {
      fireEvent.change(screen.getByTestId('offline-input'), {
        target: { files: [logFile('notes.txt', 'hello world')] },
      })
    })
    expect(screen.getByTestId('offline-error').textContent).toBe(en['offline.parseError'])
    expect(called).toBe(0)
  })

  it('accepts a dropped file', async () => {
    let loaded = 0
    render(<OfflineDrop t={t} onLoad={() => { loaded += 1 }} />)
    await act(async () => {
      fireEvent.drop(screen.getByTestId('offline-drop'), {
        dataTransfer: { files: [logFile('s.jsonl', '{"type":"turn/start","seq":1,"time":0}')] },
      })
    })
    expect(loaded).toBe(1)
  })
})

describe('TheaterView with an offline log', () => {
  it('switches to the comparison pane once a log is loaded', async () => {
    render(<TheaterView
      session={fakeSession([textRun({ seq: 1, time: T0, texts: ['live'], dt: [] })])}
      loadOlder={async () => true}
      t={t}
    />)
    expect(screen.queryByTestId('compare-root')).toBeNull()
    await act(async () => {
      fireEvent.change(screen.getByTestId('offline-input'), {
        target: { files: [logFile('base.jsonl', '{"type":"text-chunks","data":{"dt":[5],"texts":["live","!"]}}')] },
      })
    })
    expect(screen.getByTestId('compare-root')).toBeDefined()
    expect(screen.getByTestId('offline-loaded').textContent).toContain('base.jsonl')
  })

  it('warns that a timestamp-free log has synthetic cadence', async () => {
    render(<TheaterView
      session={fakeSession([textRun({ seq: 1, time: T0, texts: ['x'], dt: [] })])}
      loadOlder={async () => true}
      t={t}
    />)
    await act(async () => {
      fireEvent.change(screen.getByTestId('offline-input'), {
        target: { files: [logFile('norm.jsonl', '{"type":"turn/start"}')] },
      })
    })
    expect(screen.getByTestId('offline-loaded').textContent).toContain(en['offline.synthetic'])
  })

  it('returns to single-session replay when the log is closed', async () => {
    render(<TheaterView
      session={fakeSession([textRun({ seq: 1, time: T0, texts: ['live'], dt: [] })])}
      loadOlder={async () => true}
      t={t}
    />)
    await act(async () => {
      fireEvent.change(screen.getByTestId('offline-input'), {
        target: { files: [logFile('b.jsonl', '{"type":"turn/start","seq":1,"time":0}')] },
      })
    })
    fireEvent.click(screen.getByTestId('offline-clear'))
    expect(screen.queryByTestId('compare-root')).toBeNull()
    expect(screen.getByTestId('theater-stage')).toBeDefined()
  })

  it('keeps the transport bar driving the live side during comparison', async () => {
    render(<TheaterView
      session={fakeSession([textRun({ seq: 1, time: T0, texts: ['a', 'b'], dt: [10] })])}
      loadOlder={async () => true}
      t={t}
    />)
    await act(async () => {
      fireEvent.change(screen.getByTestId('offline-input'), {
        target: { files: [logFile('b.jsonl', '{"type":"turn/start","seq":1,"time":0}')] },
      })
    })
    expect(screen.getByTestId('compare-left').textContent).toContain('a')
    fireEvent.click(screen.getByLabelText(en['control.stepForward']))
    expect(screen.getByTestId('compare-left').textContent).toContain('ab')
  })
})
