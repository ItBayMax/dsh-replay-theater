/**
 * Locale dictionaries for the theater.
 *
 * dsh 0.1.2 made locale ownership a hard rule: all product-authored client UI
 * wording belongs to locale dictionaries, Cordis-free atoms must receive
 * complete localized copy props with no fallback wording, and localized text
 * never carries identity (match first, translate second). So the dictionaries
 * exist from the first commit rather than being extracted later.
 *
 * @module dsh-replay-theater/client/locales
 */

/** Locale namespace this plugin owns. */
export const NS = 'replay.theater'

/** English dictionary. Keys are stable identifiers; values are display copy. */
export const en = {
  'view.theater': 'Theater',
  'control.play': 'Play',
  'control.pause': 'Pause',
  'control.stepBack': 'Step back',
  'control.stepForward': 'Step forward',
  'control.restart': 'Restart',
  'control.speed': 'Speed',
  'control.loadOlder': 'Load earlier history',
  'control.loading': 'Loading…',
  'stage.empty': 'No replayable history in this window yet.',
  'stage.emptyHint': 'Assistant output is replayed token by token once this session has streamed a reply.',
  'stage.reasoning': 'Reasoning',
  'stage.toolCall': 'Tool call',
  'stage.marker': 'Event',
  'status.position': 'Position',
  'status.total': 'Total',
  'status.frames': '{count} frames',
  'status.compressed': 'Long pauses compressed to {ms} ms',
  'settings.maxGap': 'Max pause',
  'settings.maxGapHint': 'Silences longer than this are compressed during playback.',
  'compare.title': 'Side-by-side',
  'compare.left': 'Left',
  'compare.right': 'Right',
  'compare.pickRight': 'Pick a session to compare',
  'compare.exit': 'Exit comparison',
  'compare.divergeAt': 'First divergence at seq {seq}',
  'compare.identical': 'No divergence found in the loaded windows',
  'offline.title': 'Open a recorded session',
  'offline.hint': 'Drop a session.jsonl file here, or click to choose one.',
  'offline.parseError': 'That file could not be read as a session log.',
  'offline.loaded': 'Loaded {count} events from {name}',
  'offline.clear': 'Close file',
  'offline.synthetic': 'This log carried no timestamps — cadence is uniform, not original',
} as const

/** Chinese dictionary. Same key set as {@link en} — parity is a hard rule. */
export const zh = {
  'view.theater': '剧场',
  'control.play': '播放',
  'control.pause': '暂停',
  'control.stepBack': '上一帧',
  'control.stepForward': '下一帧',
  'control.restart': '重新播放',
  'control.speed': '倍速',
  'control.loadOlder': '加载更早的历史',
  'control.loading': '加载中…',
  'stage.empty': '当前窗口还没有可回放的历史。',
  'stage.emptyHint': '会话产生流式回复后，助手输出会逐 token 重演。',
  'stage.reasoning': '推理',
  'stage.toolCall': '工具调用',
  'stage.marker': '事件',
  'status.position': '进度',
  'status.total': '总时长',
  'status.frames': '{count} 帧',
  'status.compressed': '长静默已压缩到 {ms} 毫秒',
  'settings.maxGap': '最长停顿',
  'settings.maxGapHint': '超过该时长的静默会在回放时被压缩。',
  'compare.title': '并排对比',
  'compare.left': '左',
  'compare.right': '右',
  'compare.pickRight': '选择要对比的会话',
  'compare.exit': '退出对比',
  'compare.divergeAt': '首个分歧在 seq {seq}',
  'compare.identical': '已加载的窗口内没有发现分歧',
  'offline.title': '打开录制的会话',
  'offline.hint': '把 session.jsonl 拖到这里，或点击选择文件。',
  'offline.parseError': '这个文件无法作为会话日志读取。',
  'offline.loaded': '已从 {name} 载入 {count} 个事件',
  'offline.clear': '关闭文件',
  'offline.synthetic': '该日志没有时间戳——节奏是均匀的，不是原始节奏',
} as const

/** Key union for this namespace, used by the dsh locale service declaration. */
export type TheaterKey = keyof typeof en

/**
 * Fill `{placeholder}` slots in a dictionary value.
 * @param template - the dictionary string.
 * @param values - replacement values by placeholder name.
 * @returns the formatted string; an unmatched placeholder is left verbatim.
 */
export function format(template: string, values: Readonly<Record<string, string | number>>): string {
  return template.replace(/\{(\w+)\}/gu, (whole, key: string) => {
    const value = values[key]
    return value === undefined ? whole : String(value)
  })
}
