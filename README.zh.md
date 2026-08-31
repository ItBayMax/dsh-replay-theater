# dsh-replay-theater

[![dsh plugin](https://img.shields.io/badge/dsh-plugin-%E2%9C%85-green)](https://github.com/topics/dsh-plugin)
[![Node](https://img.shields.io/badge/node-%5E22.19%20%7C%7C%20%3E%3D24-brightgreen.svg)](#)

[English](README.md) | 中文

**按原始 token 节奏重演一次 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 会话**——站内播放剧场，支持播放、暂停、单步、倍速、拖拽跳转。

不是静态时间线：助手的回答一个 token 一个 token 地长出来，间隔就是当时生成时记录的真实毫秒数。

## 为什么会有这个插件

上游把每个 token 的真实到达间隔完整保留在会话日志里，并写明了原因：

```ts
// packages/core/session/src/chunk-rows.ts:44
/** Epoch-ms gaps between consecutive members; length is one less than the member count. */
dt: number[]
```

> *"one entry per member, never joined — **token boundaries are data**"* —— chunk-rows.ts:48

打包存储时**刻意不把**一段 run 的成员合并成一个字符串，所以节奏得以保留。而 harness 里没有任何东西用过这份数据。这个插件就是那个使用者。

## 安装

```bash
dsh plugin --profile web add dsh-replay-theater
```

或从仓库直装：

```bash
dsh plugin --profile web add "github:ItBayMax/dsh-replay-theater#main"
```

包里声明了 `dsh.bundle`，CLI 会自动把它并入 profile 的层列表——**不需要手改 `cordis.patch.yml`**。重启 `dsh web` 打开任一会话，Chat 与 Trajectory 旁边会出现 **剧场** 标签页。

## 使用

| 控件 | 行为 |
|---|---|
| ▶ / ❚❚ | 播放 / 暂停。已在末尾时按播放会从头重播 |
| ⏴ / ⏵ | 单步后退 / 前进一帧（一个 token）。单步会暂停 |
| ⤾ | 回到开头并暂停，保留当前倍速 |
| 进度条 | 跳转到绝对位置 |
| 倍速 | 0.5× 到 8× |
| 最长停顿 | 压缩超过该时长的静默（200ms … ∞）。选 `∞` 保留真实墙钟节奏 |
| 加载更早的历史 | 向前翻一个窗口，播放位置不丢 |

只要有静默被压缩，播放条就会显示压缩了多少毫秒。**回放改动了数据的时间，所以它必须告知**。

## 回放什么

浏览器会话窗口里的一切：助手正文、推理、工具调用参数（各自成流），以及标量事件（`step/start`、`tool/result`…）作为 marker。

**工具调用显示为累积的 JSON + 工具名**，不是完整工具卡片。卡片是 `ui-tool` 的职责，这个插件专注节奏。

## 边界

- **无随机访问**：dsh 客户端无法请求任意序号——历史只能向前翻页、一次一个窗口（`session.loadOlder()`），而生产环境单个尾页可达几十万事件。所以剧场回放**已加载的窗口**，并给一个显式的"加载更早"动作，而不是悄悄把整条日志拉进浏览器。
- **长静默默认被压缩**（上限 2000ms）。要真实节奏请选 `∞`。
- **实时会话会在你脚下增长**：窗口是被跟随的，追加帧时播放位置不会丢。
- **类型是镜像而非导入**：`@deepseek-ai/dsh-api-session-controller` 未发布到 npm，所以 `src/core/wire.ts` 与 `src/client/dsh.ts` 自持上游形状的结构化镜像，逐条标注读取自哪个 `file:line`（钉在 dsh `0a53fb5` / `0.1.2-alpha.2`）。它们结构兼容，将来换成真 import 不需要改任何调用点。

## 兼容性

针对 **dsh `0.1.2-alpha.2`**（上游 commit `0a53fb5`）开发。只读公开客户端面——`session.eventSource` 与 `session.loadOlder()`——因为上游在 0.1.2 里删掉了整个 `client/runtime` 包，依赖内部实现活不长。

## 开发

```bash
npm install
npm test          # 148 个测试
npm run typecheck
```

回放核心（`src/core/`）零框架零 dsh 依赖，所以它的规则不需要浏览器或 harness checkout 就能单测：

```bash
npx vitest run tests/timeline.spec.ts tests/player.spec.ts
```

测试夹具分两种，理由有据：

- **`tests/fixtures/synthetic.ts`**——手工构造、`dt` 数组精确。节奏断言都在这里。
- **`tests/fixtures/corpus-*.json`**——由 `make-corpus-fixture.mjs` 从上游录制会话派生，用来证明 wire 镜像能吃真实形状。它**无法**承载节奏断言：上游语料归一化时剥掉了 `seq`/`time`，而全部 118 个快照会话里最长的"连续同块 delta"只有 2 个成员。

架构与各阶段实现记录见 [`docs/`](docs/)。

## 离线命令行

回放核心零框架依赖，所以浏览器标签页用的那些函数在脚本里同样可用：

```bash
npm run build
node scripts/replay-cli.mjs path/to/session.jsonl --frames 20
node scripts/replay-cli.mjs run-a.jsonl run-b.jsonl        # 对比两次运行
```

比如对比两份上游快照，会报出它们从哪里开始不一致：

```
comparison: diverged at frame 14 (marker-type), left seq 15 / right seq 15
```

## 许可

MIT
