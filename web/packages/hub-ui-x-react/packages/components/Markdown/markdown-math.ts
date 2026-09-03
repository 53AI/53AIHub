/**
 * Markdown 数学公式（KaTeX）相关的排版兼容处理。
 *
 * 核心根因：@vscode/markdown-it-katex 的 blockMath 只有「闭合 $$ 位于行尾」时才把
 * 单行 `$$...$$` 当成数学块闭合（检查 `endIndexes[0].index === firstLine.length - 2`）。
 * 一旦闭合 $$ 后面还跟着任何内容（引用、正文、加粗、链接等——无论是否空格分隔），
 * 解析器都找不到闭合符，会把 `$$...$$<其余同行内容>` 整段吞进 math_block 的 content，
 * 导致 KaTeX 渲染失败。
 *
 * 对应的两类处理：
 *
 * 1. normalizeBlockMathTrailing：把块级数学行「闭合 $$ 后的尾随内容」拆到下一行，让
 *    数学块正常闭合。修复对象是所有同行尾随内容（不限于 source 引用），且跳过 ``` 代码块。
 *
 * 2. splitPendingMath：打字机流式输出时逐字符追加，中间态常见「$$ 只开不闭」的残缺公式，
 *    KaTeX 每次都会尝试渲染残缺串导致公式闪现「解析失败」。把末尾未闭合的数学块暂存，
 *    等闭合后再一次性渲染（直接渲染）。
 */

/** 代码围栏（不属意 normalization 的正文区间） */
const FENCE_REGEX = /```[\s\S]*?```/g;

/**
 * 单个段落（不含代码围栏）内部，把块级数学行尾随的非空内容拆到下一行。
 */
function normalizeBlockMathLines(segment: string): string {
  return segment
    .split("\n")
    .map((line) => {
      // 仅处理「行首（可带缩进/blockquote）为 $$」的块级数学行
      const m = line.match(/^(\s*>?\s*)(\$\$)([\s\S]*)$/);
      if (!m) return line;
      const body = m[3];
      const closes = [...body.matchAll(/\$\$/g)];
      // 只在「恰好一个闭合 $$」时处理：多个 $$ 会被插件当行内数学（本身可正常闭合），
      // 强行拆分反而改变语义。
      if (closes.length === 1) {
        const closeIdx = closes[0].index;
        if (closeIdx + 2 < body.length) {
          const core = body.slice(0, closeIdx);
          const trail = body.slice(closeIdx + 2);
          return `${m[1]}$$${core}$$\n${trail}`;
        }
      }
      return line;
    })
    .join("\n");
}

/**
 * 把 `$$...$$<尾随内容>` 拆成 `$$...$$\n<尾随内容>`，让数学块正常闭合、尾随内容落到
 * 下一段文本。跳过 ``` 代码块，避免破坏围栏内的 `$$`。
 */
export function normalizeBlockMathTrailing(content: string): string {
  let result = "";
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  FENCE_REGEX.lastIndex = 0;
  while ((match = FENCE_REGEX.exec(content)) !== null) {
    result += normalizeBlockMathLines(content.slice(lastIndex, match.index));
    result += match[0];
    lastIndex = match.index + match[0].length;
  }
  result += normalizeBlockMathLines(content.slice(lastIndex));
  return result;
}

/**
 * 从 content 末尾切出「未闭合的数学尾部」。
 * 返回 { safe, pending }：safe 可直接交给渲染（数学全部闭合），pending 是需要暂存的
 * 未闭合 `$...$` / `$$...$$` 尾部（为空串表示没有未闭合的数学）。
 */
export function splitPendingMath(content: string): {
  safe: string;
  pending: string;
} {
  const len = content.length;
  let pendingStart = -1;
  let i = 0;

  while (i < len) {
    const ch = content[i];
    if (ch === "\\") {
      // LaTeX 转义（含 `\\` 换行），跳过自身与被转义的下一字符
      i += 2;
      continue;
    }
    if (content.startsWith("$$", i)) {
      const close = content.indexOf("$$", i + 2);
      if (close === -1) {
        pendingStart = i;
        break;
      }
      i = close + 2;
    } else if (ch === "$") {
      const close = content.indexOf("$", i + 1);
      if (close === -1) {
        pendingStart = i;
        break;
      }
      i = close + 1;
    } else {
      i += 1;
    }
  }

  if (pendingStart === -1) return { safe: content, pending: "" };
  return { safe: content.slice(0, pendingStart), pending: content.slice(pendingStart) };
}