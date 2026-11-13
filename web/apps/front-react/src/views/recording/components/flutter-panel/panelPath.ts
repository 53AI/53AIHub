/**
 * Flutter 面板 URL → 站内路径的解析工具。
 *
 * 面板 URL 的 hash 段即 Flutter 站内路径（含查询参数），形如
 * `http://host/#/recording/detail/1?discuss=1`（Flutter Web 默认
 * HashUrlStrategy，见 flutterUrl.ts）。RecordingFlutterPanel 发送
 * km-navigate 站内导航时据此提取目标路径。
 */

/** 从面板完整 URL 提取 Flutter 站内路径（hash 段含查询参数），如 /recording/detail/1?discuss=1 */
export const extractFlutterPath = (url: string): string => {
  const hashIndex = url.indexOf('#')
  return hashIndex >= 0 ? url.slice(hashIndex + 1) || '/' : '/'
}
