/**
 * Playback state machine.
 *
 * React-free and clock-injectable so playback rules are unit-testable without
 * timers or a DOM: the owner advances it with `tick(nowMs)` and the machine
 * decides where the playhead lands. Nothing here schedules work.
 *
 * @module dsh-replay-theater/core/player
 */

import type { Timeline } from './timeline.ts'
import { frameIndexAt } from './timeline.ts'

/** Playback speeds the UI offers. */
export const SPEEDS = [0.5, 1, 2, 4, 8] as const

/** One offered playback speed. */
export type Speed = typeof SPEEDS[number]

/** Immutable playback state. */
export interface PlayerState {
  /** Playhead position in timeline milliseconds. */
  readonly positionMs: number
  /** Whether the playhead is advancing. */
  readonly playing: boolean
  /** Playback rate multiplier. */
  readonly speed: Speed
  /**
   * Index of the last frame at or before the playhead; -1 before the first.
   * Kept in state (not derived per render) so the stage can memoize on it.
   */
  readonly frameIndex: number
  /** Wall-clock reading of the last `tick`, or undefined while paused. */
  readonly lastTickMs?: number
}

/** A player bound to one timeline. */
export interface Player {
  readonly state: PlayerState
  readonly timeline: Timeline
}

/**
 * Create a paused player at the start of a timeline.
 * @param timeline - the timeline to play.
 * @returns a player positioned before the first frame.
 */
export function createPlayer(timeline: Timeline): Player {
  return {
    timeline,
    state: { positionMs: 0, playing: false, speed: 1, frameIndex: frameIndexAt(timeline, 0) },
  }
}

/**
 * Rebind a player to a new timeline, keeping the playhead where it still fits.
 *
 * Playback continues across a window growth (the user paged older history in,
 * or a live turn appended frames) instead of snapping back to the start, which
 * would make "load earlier" unusable while playing.
 * @param player - the current player.
 * @param timeline - the replacement timeline.
 * @returns a player on the new timeline.
 */
export function retarget(player: Player, timeline: Timeline): Player {
  const positionMs = Math.min(player.state.positionMs, timeline.totalMs)
  return {
    timeline,
    state: {
      ...player.state,
      positionMs,
      frameIndex: frameIndexAt(timeline, positionMs),
    },
  }
}

/**
 * Start playing from the current position.
 *
 * Restarts from zero when the playhead already sits at the end, so the play
 * button never looks dead.
 * @param player - the current player.
 * @param nowMs - wall-clock reading that anchors the first tick.
 * @returns the playing player.
 */
export function play(player: Player, nowMs: number): Player {
  const atEnd = player.state.positionMs >= player.timeline.totalMs
  const positionMs = atEnd ? 0 : player.state.positionMs
  return {
    timeline: player.timeline,
    state: {
      ...player.state,
      playing: true,
      positionMs,
      frameIndex: frameIndexAt(player.timeline, positionMs),
      lastTickMs: nowMs,
    },
  }
}

/**
 * Pause at the current position.
 * @param player - the current player.
 * @returns the paused player.
 */
export function pause(player: Player): Player {
  const { lastTickMs: _drop, ...rest } = player.state
  return { timeline: player.timeline, state: { ...rest, playing: false } }
}

/**
 * Advance the playhead to a wall-clock reading.
 *
 * Elapsed wall time is scaled by `speed`; reaching the end stops playback so a
 * finished replay does not keep burning animation frames.
 * @param player - the current player.
 * @param nowMs - current wall-clock reading.
 * @returns the advanced player, or the same object when not playing.
 */
export function tick(player: Player, nowMs: number): Player {
  const { state, timeline } = player
  if (!state.playing) return player
  const previous = state.lastTickMs ?? nowMs
  // A backwards or absent clock reading advances nothing rather than rewinding.
  const elapsed = Math.max(0, nowMs - previous)
  const positionMs = Math.min(state.positionMs + elapsed * state.speed, timeline.totalMs)
  const finished = positionMs >= timeline.totalMs
  const advanced: PlayerState = {
    ...state,
    positionMs,
    frameIndex: frameIndexAt(timeline, positionMs),
    playing: !finished,
    ...finished ? {} : { lastTickMs: nowMs },
  }
  if (finished) delete (advanced as { lastTickMs?: number }).lastTickMs
  return { timeline, state: advanced }
}

/**
 * Move the playhead to an absolute position, clamped to the timeline.
 * @param player - the current player.
 * @param positionMs - requested position in timeline milliseconds.
 * @param nowMs - wall-clock reading, used to re-anchor an active playback.
 * @returns the seeked player.
 */
export function seek(player: Player, positionMs: number, nowMs: number): Player {
  const clamped = Math.min(Math.max(0, positionMs), player.timeline.totalMs)
  return {
    timeline: player.timeline,
    state: {
      ...player.state,
      positionMs: clamped,
      frameIndex: frameIndexAt(player.timeline, clamped),
      ...player.state.playing ? { lastTickMs: nowMs } : {},
    },
  }
}

/**
 * Move the playhead by whole frames.
 *
 * Stepping pauses: single-stepping while playing would fight the tick loop.
 * @param player - the current player.
 * @param delta - frames to move; negative steps backwards.
 * @returns the stepped, paused player.
 */
export function step(player: Player, delta: number): Player {
  const { frames } = player.timeline
  if (frames.length === 0) return pause(player)
  const target = Math.min(Math.max(player.state.frameIndex + delta, 0), frames.length - 1)
  const frame = frames[target]
  const paused = pause(player)
  return {
    timeline: player.timeline,
    state: {
      ...paused.state,
      positionMs: frame?.atMs ?? 0,
      frameIndex: target,
    },
  }
}

/**
 * Set the playback rate, keeping the playhead and re-anchoring the clock.
 * @param player - the current player.
 * @param speed - the new rate.
 * @param nowMs - wall-clock reading.
 * @returns the player at the new rate.
 */
export function setSpeed(player: Player, speed: Speed, nowMs: number): Player {
  return {
    timeline: player.timeline,
    state: {
      ...player.state,
      speed,
      ...player.state.playing ? { lastTickMs: nowMs } : {},
    },
  }
}

/**
 * Return to the start, paused.
 * @param player - the current player.
 * @returns the rewound player.
 */
export function restart(player: Player): Player {
  return {
    timeline: player.timeline,
    state: {
      positionMs: 0,
      playing: false,
      speed: player.state.speed,
      frameIndex: frameIndexAt(player.timeline, 0),
    },
  }
}
