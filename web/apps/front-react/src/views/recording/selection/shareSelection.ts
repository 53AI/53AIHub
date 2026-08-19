/**
 * 录音分享选择标记（录音域专属）
 *
 * 公开 API：3 个核心 tab 布尔 + sum-* 模板 id 数组。
 * 内部状态用这个，URL 编解码由本模块自行负责（紧凑 wire 格式见下）。
 *
 * 接收端（share/recording.tsx）按 i/s/t 屏蔽核心 tab，按 sums 过滤
 * 模板总结列表；老链接（无参数 / 解码失败）走"完整可见"兼容分支。
 *
 * URL 编解码 / append 等通用能力在 `@km/shared-utils` 的 `json-token` 模块；
 * 本模块只负责把 `RecordingShareSelection` 适配成紧凑 wire 形状。
 */

import {
  decodeJsonToken,
  appendJsonTokenToUrl,
} from '@km/shared-utils'

/** 录音分享可选内容的选择标记（公开 API） */
export interface RecordingShareSelection {
  i: boolean
  s: boolean
  t: boolean
  /** 选中的模板总结 id（每个 sum-* 模板独立勾选） */
  sums: string[]
}

/** 默认勾选：仅洞察；纪要 / 转写 / 模板总结默认关闭 */
export const DEFAULT_RECORDING_SHARE_SELECTION: RecordingShareSelection = {
  i: true,
  s: false,
  t: false,
  sums: [],
}

/**
 * 是否还有任何一类被勾选。
 * popover 在用户取消全部勾选时据此禁用复制按钮 / QR 按钮。
 */
export function hasAnySelected(selection: RecordingShareSelection): boolean {
  return selection.i || selection.s || selection.t || selection.sums.length > 0
}

/** 在不含 sums 的视角下，是否还有任何核心 tab 被勾选（用于 toggleTab 的 guard） */
function hasAnyCoreTab(s: RecordingShareSelection): boolean {
  return s.i || s.s || s.t
}

/**
 * 切换 i/s/t 之一。强制「至少一项」：取消最后一个勾选时返回原对象（不让它真的关掉）。
 */
export function toggleRecordingTab(
  selection: RecordingShareSelection,
  key: 'i' | 's' | 't',
): RecordingShareSelection {
  if (!selection[key]) {
    return { ...selection, [key]: true }
  }
  const otherCoreOn =
    (key !== 'i' && selection.i) || (key !== 's' && selection.s) || (key !== 't' && selection.t)
  if (!otherCoreOn && selection.sums.length === 0) {
    return selection
  }
  return { ...selection, [key]: false }
}

/**
 * 切换 sums 中的某个 id。强制「至少一项」：当 sums 数组只剩最后一项时取消 → 不生效。
 */
export function toggleRecordingSummary(
  selection: RecordingShareSelection,
  id: string,
): RecordingShareSelection {
  const idx = selection.sums.indexOf(id)
  if (idx < 0) {
    return { ...selection, sums: [...selection.sums, id] }
  }
  if (selection.sums.length === 1 && !hasAnyCoreTab(selection)) {
    return selection
  }
  return { ...selection, sums: selection.sums.filter((x) => x !== id) }
}

// ── Wire format ──────────────────────────────────────────────────────────
// 紧凑 JSON：3 个核心 tab 折叠到 1 个 bitmask，sums 存数组。
//   b: 0..7 的整数（bit0=i, bit1=s, bit2=t）
//   m: string[]（sums 数组）
// 默认形状：`{"b":1,"m":[]}` → base64url 约 20 字符；
// 之前 `{"i":true,"s":false,"t":false,"sums":[]}` → 约 60 字符。

const BIT_I = 1
const BIT_S = 2
const BIT_T = 4
const BIT_MASK = BIT_I | BIT_S | BIT_T

interface CompactSelection {
  b: number
  m: string[]
}

function toCompact(s: RecordingShareSelection): CompactSelection {
  return {
    b: (s.i ? BIT_I : 0) | (s.s ? BIT_S : 0) | (s.t ? BIT_T : 0),
    m: s.sums,
  }
}

function fromCompact(c: CompactSelection): RecordingShareSelection {
  return {
    i: (c.b & BIT_I) !== 0,
    s: (c.b & BIT_S) !== 0,
    t: (c.b & BIT_T) !== 0,
    sums: c.m,
  }
}

/**
 * 把选择追加到 URL 后面：保留原 query / hash，自动选 ?/&。
 * 内部用紧凑 bitmask 编码。
 */
export function appendRecordingSelectionToUrl(
  url: string,
  selection: RecordingShareSelection,
): string {
  return appendJsonTokenToUrl(url, toCompact(selection))
}

/**
 * 从 URLSearchParams 读出选择 token。失败 / 缺失 / 形状不对 → null。
 * null 时调用方按"完整可见"分支处理。
 */
export function decodeRecordingSelection(
  searchParams: URLSearchParams,
): RecordingShareSelection | null {
  const raw = decodeJsonToken<unknown>(searchParams.get('t'))
  if (!raw || typeof raw !== 'object') return null
  const obj = raw as Record<string, unknown>
  if (
    typeof obj.b !== 'number' ||
    !Number.isInteger(obj.b) ||
    obj.b < 0 ||
    obj.b > BIT_MASK
    ) {
    return null
  }
  if (!Array.isArray(obj.m) || !obj.m.every((x) => typeof x === 'string')) {
    return null
  }
  return fromCompact({ b: obj.b, m: obj.m as string[] })
}