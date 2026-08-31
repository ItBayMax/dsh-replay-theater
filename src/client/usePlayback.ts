/**
 * React binding for the framework-free player.
 *
 * The hook owns exactly three things the core cannot: subscribing to the live
 * session window, driving `tick` from `requestAnimationFrame`, and exposing
 * imperative controls. Every playback rule stays in `core/player.ts`.
 *
 * @module dsh-replay-theater/client/usePlayback
 */

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { Player, Speed } from '../core/player.ts'
import {
  createPlayer,
  pause as pausePlayer,
  play as playPlayer,
  restart as restartPlayer,
  retarget,
  seek as seekPlayer,
  setSpeed as setSpeedPlayer,
  step as stepPlayer,
  tick as tickPlayer,
} from '../core/player.ts'
import type { StageState, Timeline, TimelineOptions } from '../core/timeline.ts'
import { buildTimeline, stageAt } from '../core/timeline.ts'
import type { ClientSession } from './dsh.ts'

/** What the view needs to render and control playback. */
export interface Playback {
  readonly timeline: Timeline
  readonly player: Player
  readonly stage: StageState
  play: () => void
  pause: () => void
  toggle: () => void
  stepBy: (delta: number) => void
  seekTo: (positionMs: number) => void
  setSpeed: (speed: Speed) => void
  restart: () => void
}

/** Monotonic clock; falls back to Date.now where performance is unavailable. */
function now(): number {
  return typeof performance === 'undefined' ? Date.now() : performance.now()
}

/**
 * Bind a session's history window to a playable, controllable timeline.
 * @param session - the client session whose window is replayed.
 * @param options - cadence tunables forwarded to the timeline builder.
 * @returns playback state and controls.
 */
export function usePlayback(session: ClientSession, options: TimelineOptions = {}): Playback {
  const window = useSyncExternalStore(
    useCallback(listener => session.eventSource.subscribe(listener), [session]),
    useCallback(() => session.eventSource.getSnapshot(), [session]),
  )

  const maxGapMs = options.maxGapMs
  const timeline = useMemo(
    // The window's revision changes on every accepted mutation, so it is the
    // correct dependency: rebuilding on `entries` identity alone would miss an
    // in-place growth, and rebuilding every render would be wasteful.
    () => buildTimeline(window.entries, maxGapMs === undefined ? {} : { maxGapMs }),
    [window.revision, window.entries, maxGapMs],
  )

  const [player, setPlayer] = useState<Player>(() => createPlayer(timeline))

  // Follow the timeline without losing the playhead (paging older history in
  // must not snap playback back to the start).
  const boundTimeline = useRef(timeline)
  useEffect(() => {
    if (boundTimeline.current === timeline) return
    boundTimeline.current = timeline
    setPlayer(current => retarget(current, timeline))
  }, [timeline])

  const playing = player.state.playing
  useEffect(() => {
    if (!playing) return undefined
    let frame = 0
    const loop = (): void => {
      setPlayer(current => tickPlayer(current, now()))
      frame = requestAnimationFrame(loop)
    }
    frame = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(frame)
  }, [playing])

  const stage = useMemo(() => stageAt(timeline, player.state.frameIndex), [timeline, player.state.frameIndex])

  return {
    timeline,
    player,
    stage,
    play: useCallback(() => setPlayer(current => playPlayer(current, now())), []),
    pause: useCallback(() => setPlayer(pausePlayer), []),
    toggle: useCallback(() => setPlayer(current => (
      current.state.playing ? pausePlayer(current) : playPlayer(current, now())
    )), []),
    stepBy: useCallback((delta: number) => setPlayer(current => stepPlayer(current, delta)), []),
    seekTo: useCallback((positionMs: number) => setPlayer(
      current => seekPlayer(current, positionMs, now()),
    ), []),
    setSpeed: useCallback((speed: Speed) => setPlayer(
      current => setSpeedPlayer(current, speed, now()),
    ), []),
    restart: useCallback(() => setPlayer(restartPlayer), []),
  }
}
