/**
 * Mermaid 源码的通用文本归一化工具。
 *
 * 三个解析器（flowchart / 非流程图方言 / 图结构方言）都要做同样的
 * 「按行切分 + 去注释 + 去转义引号」处理，统一放在这里，避免各写一份后
 * 只在一处修 bug。
 */

/** 按行切分并去掉注释：兼容 CRLF，`%%` 起为 Mermaid 注释 */
export function toLines(source: string): string[] {
  return String(source || '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => l.replace(/%%.*$/, ''))
}

/** 去掉首尾配对的引号（Mermaid 里引号只是转义手段，不是内容） */
export function unquote(raw: string): string {
  const s = (raw || '').trim()
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) return s.slice(1, -1).trim()
  if (s.length >= 2 && s.startsWith("'") && s.endsWith("'")) return s.slice(1, -1).trim()
  return s
}
