# dsh-replay-theater

[![dsh plugin](https://img.shields.io/badge/dsh-plugin-%E2%9C%85-green)](https://github.com/topics/dsh-plugin)
[![Node](https://img.shields.io/badge/node-%5E22.19%20%7C%7C%20%3E%3D24-brightgreen.svg)](#)

English | [中文](README.zh.md)

**Replay a [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) session at its original token cadence** — an in-app playback theater with play, pause, single-step, speed and seek.

Not a static timeline: the assistant's answer grows token by token, spaced by the real millisecond gaps recorded when it was generated.

![The Theater tab replaying a recorded session](assets/screenshot-stage-en.png)

<details>
<summary><b>More screenshots</b> — transport controls, and side-by-side comparison</summary>

**Transport bar and marker rail.** Play/pause, single-step, restart, scrub, speed, and a
"max pause" ceiling. Scalar events (`step/start`, `tool/result`, …) sit on their own rail, and
the bar states how much silence was compressed — playback alters timing, so it says so.

![Transport controls and the marker rail](assets/screenshot-transport-en.png)

**Side-by-side comparison (v2).** Load a recorded `session.jsonl` next to the live one and the
theater reports where the two runs stop matching, with a seek coordinate for each side.

![Two runs compared, with the first divergence highlighted](assets/screenshot-compare-en.png)

</details>


## Why this exists

Upstream keeps every token's real inter-arrival gap in the session log, and is explicit that this is deliberate:

```ts
// packages/core/session/src/types.ts:341-348
'assistant/message': {
  turn: number
  step: number
  message: AssistantMessage
  /** Exact timed model stream, compacted without joining delta boundaries. */
  stream: AssistantStreamRecord[]
  …
}
```

> *"**Lossless** compact representation of one model-stream attempt"* — packages/llm/llm/src/assistant-stream.ts:1-2

A settled attempt keeps its per-token gaps in `dt` rather than joining the members into one string, so the cadence survives on disk. Nothing in the harness replays it. This plugin does.

## Install

```bash
dsh plugin --profile web add dsh-replay-theater
```

Or from a checkout:

```bash
dsh plugin --profile web add "github:ItBayMax/dsh-replay-theater#main"
```

The package declares `dsh.bundle`, so the CLI reconciles it into the profile's layer list automatically — no manual `cordis.patch.yml` edit. Restart `dsh web` and open a session: a **Theater** tab appears beside Chat and Trajectory.

## Use

| Control | Behavior |
|---|---|
| ▶ / ❚❚ | Play or pause. Playing at the end restarts from the beginning. |
| ⏴ / ⏵ | Step one frame (one token) back or forward. Stepping pauses. |
| ⤾ | Restart, paused, keeping the chosen speed. |
| Scrub | Seek to an absolute position. |
| Speed | 0.5× to 8×. |
| Max pause | Compress silences longer than this (200 ms … ∞). `∞` keeps true wall-clock cadence. |
| Load earlier history | Page one older window in. Playback keeps its position. |

When any silence was compressed, the transport bar says so and by how much. Playback alters the data's timing, so it tells you.

## What it replays

Everything the browser's session window holds: assistant text, reasoning, and tool-call arguments — each as its own stream — plus scalar events (`step/start`, `tool/result`, …) as markers.

**Tool calls show as accumulating JSON plus the tool name**, not as full tool cards. Cards are `ui-tool`'s job; this plugin is about cadence.

## Limits

- **No random access.** The dsh client cannot request an arbitrary sequence: history pages backwards only, one window at a time (`session.loadOlder()`), and a production tail page can hold hundreds of thousands of events. So the theater replays the **loaded window** and gives you an explicit "load earlier" action rather than silently pulling an entire log into the browser.
- **Long silences are compressed by default** (2000 ms ceiling). Set `∞` for true cadence.
- **Live sessions grow under you.** The window is followed, and playback keeps its position when frames are appended.
- **Seek coordinates are attempt-grained.** Since session format v2 a settled attempt occupies **one** sequence however many tokens it holds, so a divergence report names the attempt, not the token. Ordering inside an attempt comes from stream position.
- **Types are mirrored, not imported.** `@deepseek-ai/dsh-api-session-controller` is not published to npm, so `src/core/wire.ts` and `src/client/dsh.ts` carry structural mirrors of the upstream shapes, each annotated with the `file:line` it was read from (pinned to dsh `639ed01` / `0.2.0-rc.2`). They are structurally compatible, so swapping them for real imports later needs no call-site changes.

## Compatibility

Developed against **dsh `0.2.0-rc.2`** (upstream commit `639ed01`). It reads only the public client surface — `session.eventSource` and `session.loadOlder()` — because upstream removes whole client packages between minor versions; depending on internals is not survivable.

**Reads both on-disk generations.** A settled attempt is one `assistant/message` / `assistant/attempt` carrying its packed runs in `data.stream` (format v2 and later, current is v4). Generation-0 logs — the ones named `session.jsonl` with no version suffix — stored one packed row per run instead; the offline parser lifts those into the current shape, so old files still replay.

Client-only `transient` entries are ignored: upstream replaces them atomically with the settled event, and replaying both would play every token twice.

## Development

```bash
npm install
npm test          # 165 tests
npm run typecheck
```

The replay core (`src/core/`) is framework-free and dsh-free, so its rules are unit-tested without a browser or a harness checkout:

```bash
npx vitest run tests/timeline.spec.ts tests/player.spec.ts
```

Test fixtures come in two kinds, for a documented reason:

- **`tests/fixtures/synthetic.ts`** — hand-built records with exact `dt` arrays. Cadence assertions live here.
- **`tests/fixtures/corpus-*.json`** — derived from an upstream recorded session by `make-corpus-fixture.mjs`, to prove the wire mirror accepts real shapes. What the corpus can and cannot prove changed with 0.2.0, measured on `639ed01`:
  - **Structure: yes.** 173 `session.v3.jsonl` snapshots, 168 carrying a stream, 526 packed runs. Run-level `time0` and `dt` survive normalization in **all 526** (400 distinct `time0` epoch-ms values), and the longest single run holds **2047** members — so the shape this plugin expands is well covered.
  - **Real cadence: no.** Row-level `seq`/`time` are still normalized away (0 of 4343 rows keep them), 373 of the 526 runs have an all-zero `dt`, and the largest gap anywhere in the corpus is **156 ms**. These were recorded against fast or stubbed models, so there is no "model pauses to think" cadence to assert on. Timing tests use the synthetic fixtures.

See [`docs/`](docs/) for the architecture and per-phase implementation notes.
Docs 01-06 are a development log kept as written against 0.1.2; the current
wire shape and what the 0.2.0 port changed are in [07](docs/07-%E7%A7%BB%E6%A4%8D%E5%88%B0-0.2.0.md).

## Offline CLI

The replay core is framework-free, so the same functions the browser tab uses also work in a script:

```bash
npm run build
node scripts/replay-cli.mjs path/to/session.jsonl --frames 20
node scripts/replay-cli.mjs run-a.jsonl run-b.jsonl        # compare two runs
```

Comparing two upstream snapshots, for example, reports where they stop matching:

```
comparison: diverged at frame 14 (marker-type), left seq 15 / right seq 15
```

## License

MIT
