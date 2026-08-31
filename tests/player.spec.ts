/**
 * Behavior of the playback state machine.
 *
 * @module dsh-replay-theater/tests/player
 */

import { describe, expect, it } from 'vitest'
import {
  createPlayer,
  pause,
  play,
  restart,
  retarget,
  seek,
  setSpeed,
  step,
  tick,
} from '../src/core/player.ts'
import { buildTimeline } from '../src/core/timeline.ts'
import { T0, textRun } from './fixtures/synthetic.ts'

/** Three frames at 0 / 100 / 200 ms. */
const timeline = buildTimeline([
  textRun({ seq: 1, time: T0, texts: ['a', 'b', 'c'], dt: [100, 100] }),
])

/** An empty timeline, for the degenerate paths. */
const empty = buildTimeline([])

describe('createPlayer', () => {
  it('starts paused at the beginning', () => {
    const player = createPlayer(timeline)
    expect(player.state.playing).toBe(false)
    expect(player.state.positionMs).toBe(0)
    expect(player.state.frameIndex).toBe(0)
    expect(player.state.speed).toBe(1)
  })

  it('reports frameIndex -1 for an empty timeline', () => {
    expect(createPlayer(empty).state.frameIndex).toBe(-1)
  })
})

describe('tick', () => {
  it('does nothing while paused', () => {
    const player = createPlayer(timeline)
    expect(tick(player, 5_000)).toBe(player)
  })

  it('advances by elapsed wall time at 1x', () => {
    const player = tick(play(createPlayer(timeline), 1_000), 1_150)
    expect(player.state.positionMs).toBe(150)
    expect(player.state.frameIndex).toBe(1)
  })

  it('scales elapsed time by the speed', () => {
    const started = setSpeed(play(createPlayer(timeline), 1_000), 2, 1_000)
    expect(tick(started, 1_050).state.positionMs).toBe(100)
  })

  it('stops playing when it reaches the end', () => {
    const finished = tick(play(createPlayer(timeline), 0), 10_000)
    expect(finished.state.positionMs).toBe(timeline.totalMs)
    expect(finished.state.playing).toBe(false)
    expect(finished.state.lastTickMs).toBeUndefined()
  })

  it('never rewinds on a backwards clock reading', () => {
    const started = play(createPlayer(timeline), 5_000)
    const ticked = tick(started, 4_000)
    expect(ticked.state.positionMs).toBe(0)
  })

  it('accumulates across successive ticks', () => {
    let player = play(createPlayer(timeline), 0)
    player = tick(player, 50)
    player = tick(player, 120)
    expect(player.state.positionMs).toBe(120)
  })
})

describe('play and pause', () => {
  it('anchors the clock so the first tick measures from play time', () => {
    const player = tick(play(createPlayer(timeline), 9_000), 9_030)
    expect(player.state.positionMs).toBe(30)
  })

  it('restarts from zero when played at the end', () => {
    const finished = tick(play(createPlayer(timeline), 0), 10_000)
    const replayed = play(finished, 20_000)
    expect(replayed.state.positionMs).toBe(0)
    expect(replayed.state.playing).toBe(true)
  })

  it('drops the clock anchor when paused', () => {
    const paused = pause(play(createPlayer(timeline), 1_000))
    expect(paused.state.playing).toBe(false)
    expect(paused.state.lastTickMs).toBeUndefined()
  })

  it('keeps the position when paused', () => {
    const player = pause(tick(play(createPlayer(timeline), 0), 150))
    expect(player.state.positionMs).toBe(150)
  })
})

describe('seek', () => {
  it('moves to an absolute position and updates the frame index', () => {
    const player = seek(createPlayer(timeline), 100, 0)
    expect(player.state.positionMs).toBe(100)
    expect(player.state.frameIndex).toBe(1)
  })

  it('clamps below zero', () => {
    expect(seek(createPlayer(timeline), -500, 0).state.positionMs).toBe(0)
  })

  it('clamps past the end', () => {
    expect(seek(createPlayer(timeline), 999_999, 0).state.positionMs).toBe(timeline.totalMs)
  })

  it('re-anchors the clock while playing so the next tick is not double-counted', () => {
    const playing = play(createPlayer(timeline), 1_000)
    const seeked = seek(playing, 50, 2_000)
    expect(tick(seeked, 2_010).state.positionMs).toBe(60)
  })

  it('leaves a paused player paused', () => {
    expect(seek(createPlayer(timeline), 100, 0).state.playing).toBe(false)
  })
})

describe('step', () => {
  it('moves forward one frame and lands on its exact time', () => {
    const player = step(createPlayer(timeline), 1)
    expect(player.state.frameIndex).toBe(1)
    expect(player.state.positionMs).toBe(100)
  })

  it('moves backward one frame', () => {
    const player = step(step(createPlayer(timeline), 2), -1)
    expect(player.state.frameIndex).toBe(1)
  })

  it('pauses playback', () => {
    const player = step(play(createPlayer(timeline), 0), 1)
    expect(player.state.playing).toBe(false)
  })

  it('clamps at the last frame', () => {
    expect(step(createPlayer(timeline), 99).state.frameIndex).toBe(2)
  })

  it('clamps at the first frame', () => {
    expect(step(createPlayer(timeline), -99).state.frameIndex).toBe(0)
  })

  it('pauses without throwing on an empty timeline', () => {
    const player = step(play(createPlayer(empty), 0), 1)
    expect(player.state.playing).toBe(false)
  })
})

describe('setSpeed', () => {
  it('changes the rate while keeping the position', () => {
    const player = setSpeed(seek(createPlayer(timeline), 120, 0), 4, 0)
    expect(player.state.speed).toBe(4)
    expect(player.state.positionMs).toBe(120)
  })

  it('re-anchors the clock while playing so the old rate is not applied to new time', () => {
    const playing = play(createPlayer(timeline), 1_000)
    const faster = setSpeed(playing, 2, 1_000)
    expect(tick(faster, 1_010).state.positionMs).toBe(20)
  })
})

describe('restart', () => {
  it('returns to the start, paused, keeping the chosen speed', () => {
    const player = restart(setSpeed(tick(play(createPlayer(timeline), 0), 150), 4, 150))
    expect(player.state.positionMs).toBe(0)
    expect(player.state.playing).toBe(false)
    expect(player.state.speed).toBe(4)
  })
})

describe('retarget', () => {
  it('keeps the playhead when the timeline grows', () => {
    const grown = buildTimeline([
      textRun({ seq: 1, time: T0, texts: ['a', 'b', 'c', 'd', 'e'], dt: [100, 100, 100, 100] }),
    ])
    const player = retarget(seek(createPlayer(timeline), 150, 0), grown)
    expect(player.state.positionMs).toBe(150)
    expect(player.timeline.totalMs).toBe(400)
  })

  it('clamps the playhead when the new timeline is shorter', () => {
    const shorter = buildTimeline([textRun({ seq: 1, time: T0, texts: ['a'], dt: [] })])
    const player = retarget(seek(createPlayer(timeline), 200, 0), shorter)
    expect(player.state.positionMs).toBe(0)
  })

  it('keeps playing across a retarget', () => {
    const playing = play(createPlayer(timeline), 0)
    expect(retarget(playing, timeline).state.playing).toBe(true)
  })
})
