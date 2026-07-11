/**
 * 判断目标路径是否为非法移动目标。
 * 非法场景：
 *   1. sourcePath 与 targetPath 相同
 *   2. targetPath 是 sourcePath 的后代
 *
 * 注意：sourcePath 为根 '/' 时，任何非自身路径都合法。
 */
export function isIllegalTarget(sourcePath: string, targetPath: string): boolean {
  if (!sourcePath || !targetPath) return false
  if (sourcePath === targetPath) return true
  // 根目录是任意路径的祖先前缀，但语义上不算「后代」
  if (sourcePath === '/') return false
  // 后代必须以前缀 + '/' 匹配，避免 /A 与 /AB 混淆
  const prefix = sourcePath.endsWith('/') ? sourcePath : sourcePath + '/'
  return targetPath.startsWith(prefix)
}