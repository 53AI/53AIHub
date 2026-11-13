/**
 * SafeImage 兜底图映射表 —— 「这张图代表什么实体」的集中定义。
 *
 * 调用方只需声明语义 (`kind`)，不再各自记资源路径；也不想传时保持历史默认 `agent`。
 * 优先级（见 index.tsx）：letter > fallback(显式 URL) > kind > DEFAULT_SAFE_IMAGE_KIND。
 *
 * `none` = 不显示图，仅保留透明占位（布局尺寸由调用方 className/style 决定）。
 *
 * 注意：这些是「内容图缺失」的兜底，不是「类型图标」。文件后缀、资源类型等图标请用
 * `FileIcon` / `SvgIcon`，不要加进这里。
 */
export const SAFE_IMAGE_FALLBACKS = {
  /** 智能体 / 应用（历史默认） */
  agent: '/images/default_agent.png',
  /** 用户头像 */
  user: '/images/default_avatar.png',
  /** 知识库 */
  knowledge: '/images/space/knowledge-icon.png',
  /** 空间 / 团队 */
  space: '/images/space/icon.png',
  /** 技能（官方默认 logo，与后端 `/api/images/skill/logo.png` 同一文件） */
  skill: '/images/skill/logo.png',
  /** 工具 / 解析器。注意：`images/tools/builtin.png` 是纯青绿方块，不可用作兜底 */
  tool: '/images/default_tool.png',
  /** 外部网站 logo */
  website: '/images/default_website_logo.png',
  /** 提示词 */
  prompt: '/images/agent/prompt.png',
  /** 无语义的中性占位（内容图缺失、但知道它不是上面任何一种实体） */
  generic: '/images/default_placeholder.png',
  /** 不显示兜底图 */
  none: null,
} as const

export type SafeImageKind = keyof typeof SAFE_IMAGE_FALLBACKS

/** 未传 kind 时的历史默认值：保持 270+ 处已有调用行为不变 */
export const DEFAULT_SAFE_IMAGE_KIND: SafeImageKind = 'agent'

/**
 * 解析最终兜底图 URL；返回 null 表示「不显示兜底图」。
 * 入参为 undefined 时回落到历史默认 kind。
 */
export function resolveSafeImageFallback(
  kind?: SafeImageKind,
  fallback?: string,
): string | null {
  // 显式 URL 优先（逃生通道，兼容历史调用）
  if (fallback !== undefined) return fallback.trim() ? fallback : null // 空串归一为 none
  return SAFE_IMAGE_FALLBACKS[kind ?? DEFAULT_SAFE_IMAGE_KIND]
}
