/**
 * Markdown 格式修正工具
 * 仅修正明显错误的格式，保持正确格式不变
 */

/**
 * 修正项配置
 */
interface FixOptions {
  /** 修复标题格式：###标题 → ### 标题 */
  heading?: boolean;
  /** 修复列表格式：-项目 → - 项目（仅限行首，不影响嵌套内容） */
  list?: boolean;
  /** 修复链接格式 */
  link?: boolean;
  /** 修复图片格式 */
  image?: boolean;
  /** 修复表格列数 */
  table?: boolean;
  /** 修复代码块格式：```javascript代码 → ```javascript\n代码 */
  codeBlock?: boolean;
}

const DEFAULT_OPTIONS: FixOptions = {
  heading: true,
  list: true,
  link: true,
  image: true,
  table: true,
  codeBlock: true,
};

/**
 * 修复标题格式
 * ###标题 → ### 标题
 * 条件：# 后面紧跟非空格、非 #、非行尾的字符
 */
function fixHeading(content: string): string {
  // 只修正 # 后面紧跟非空白字符的情况
  // 保留 ###标题### 这种闭合标题
  // 保留 # @mention 这种情况
  return content.replace(/^(#{1,6})([^\s#@\n])/gm, '$1 $2');
}

/**
 * 修复列表格式
 * 只修正行首的列表标记缺少空格的情况
 * 不影响列表项中的嵌套内容
 */
function fixList(content: string): string {
  const lines = content.split('\n');
  const result: string[] = [];

  for (const line of lines) {
    let fixedLine = line;

    // 只处理行首的列表（没有缩进或只有少量缩进）
    // 无序列表：-项目 → - 项目（行首最多 3 个空格）
    if (/^(\s{0,3})([-*+])([^\s*+-])/gm.test(fixedLine)) {
      fixedLine = fixedLine.replace(/^(\s{0,3})([-*+])([^\s*+-])/, '$1$2 $3');
    }

    // 有序列表：1.项目 → 1. 项目（行首最多 3 个空格）
    if (/^(\s{0,3})(\d+\.)([^\s])/gm.test(fixedLine)) {
      fixedLine = fixedLine.replace(/^(\s{0,3})(\d+\.)([^\s])/, '$1$2 $3');
    }

    result.push(fixedLine);
  }

  return result.join('\n');
}

/**
 * 修复链接格式
 * [文本] (url) → [文本](url)（中间有多余空格）
 * [文本]（url）→ [文本](url)（中文括号）
 */
function fixLink(content: string): string {
  // 修复 [文本] (url) 格式（中间有空格）
  content = content.replace(/\[([^\]]+)\]\s+\(([^)]+)\)/g, '[$1]($2)');
  // 修复中文括号
  content = content.replace(/\[([^\]]+)\]（([^）]+)）/g, '[$1]($2)');
  return content;
}

/**
 * 修复图片格式
 * ![alt] (url) → ![alt](url)（中间有多余空格）
 * ![alt]（url）→ ![alt](url)（中文括号）
 */
function fixImage(content: string): string {
  // 修复 ![alt] (url) 格式（中间有空格）
  content = content.replace(/!\[([^\]]*)\]\s+\(([^)]+)\)/g, '![$1]($2)');
  // 修复中文括号
  content = content.replace(/!\[([^\]]*)\]（([^）]+)）/g, '![$1]($2)');
  return content;
}

/**
 * 修复表格格式
 * 只补齐列数，确保每行列数一致
 */
function fixTable(content: string): string {
  const lines = content.split('\n');
  const result: string[] = [];
  let inTable = false;
  let tableColumns = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // 检测表格行（以 | 开始和结束）
    if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
      // 解析单元格
      const cells = trimmed.slice(1, -1).split('|').map((c) => c.trim());
      const cellCount = cells.length;

      if (!inTable) {
        // 新表格开始，记录列数
        inTable = true;
        tableColumns = cellCount;
        result.push(line);
      } else {
        // 检测分隔符行
        const isSeparator = cells.every((c) => /^:?-+:?$/.test(c));

        if (isSeparator) {
          // 补齐分隔符行
          while (cells.length < tableColumns) {
            cells.push('---');
          }
          result.push('| ' + cells.join(' | ') + ' |');
        } else {
          // 更新最大列数
          if (cellCount > tableColumns) {
            tableColumns = cellCount;
            // 补齐之前的行
            for (let j = result.length - 1; j >= 0; j--) {
              const prevLine = result[j];
              if (prevLine.trim().startsWith('|') && prevLine.trim().endsWith('|')) {
                const prevCells = prevLine.trim().slice(1, -1).split('|').map((c) => c.trim());
                // 检查是否是分隔符行
                const prevIsSeparator = prevCells.every((c) => /^:?-+:?$/.test(c));
                while (prevCells.length < tableColumns) {
                  if (prevIsSeparator) {
                    prevCells.push('---');
                  } else {
                    prevCells.push('');
                  }
                }
                result[j] = '| ' + prevCells.join(' | ') + ' |';
              } else {
                break;
              }
            }
          }
          // 补齐当前行
          while (cells.length < tableColumns) {
            cells.push('');
          }
          result.push('| ' + cells.join(' | ') + ' |');
        }
      }
    } else {
      // 非表格行
      if (inTable) {
        inTable = false;
        tableColumns = 0;
      }
      result.push(line);
    }
  }

  return result.join('\n');
}

/**
 * 修复代码块格式
 * ```javascript代码 → ```javascript\n代码
 * AI 有时会将代码块开始标记和代码内容挤在一起
 */
function fixCodeBlock(content: string): string {
  const lines = content.split('\n');
  const result: string[] = [];
  let inCodeBlock = false;

  for (const line of lines) {
    // 检测代码块开始：行首的 ```lang
    const codeBlockStartMatch = line.match(/^(```[a-zA-Z0-9_-]*)/);

    if (codeBlockStartMatch) {
      const codeBlockStart = codeBlockStartMatch[1];
      const restOfLine = line.slice(codeBlockStart.length);

      // 如果后面紧跟非空内容（非换行字符），需要添加换行
      if (restOfLine.length > 0 && !restOfLine.startsWith('\n')) {
        // 只有不在代码块内时才修复（这是新的代码块开始）
        if (!inCodeBlock) {
          result.push(codeBlockStart);
          result.push(restOfLine);
          inCodeBlock = true;
          continue;
        }
      } else {
        // 正常的代码块开始
        inCodeBlock = !inCodeBlock;
      }
    }

    result.push(line);
  }

  return result.join('\n');
}

/**
 * 主修复函数
 * 只修正明显错误的格式
 */
export function fixMarkdownFormat(
  content: string,
  options: FixOptions = DEFAULT_OPTIONS
): string {
  let result = content;

  if (options.heading) {
    result = fixHeading(result);
  }

  if (options.list) {
    result = fixList(result);
  }

  if (options.link) {
    result = fixLink(result);
  }

  if (options.image) {
    result = fixImage(result);
  }

  if (options.table) {
    result = fixTable(result);
  }
  if (options.codeBlock) {
    result = fixCodeBlock(result);
  }

  return result;
}

/**
 * markdown-it 插件
 * 在解析前自动修正格式
 */
export function markdownItFixPlugin(md: any, options: FixOptions = DEFAULT_OPTIONS) {
  const originalParse = md.parse.bind(md);

  md.parse = (src: string, env: any) => {
    const fixedSrc = fixMarkdownFormat(src, options);
    return originalParse(fixedSrc, env);
  };
}

export type { FixOptions };
export default fixMarkdownFormat;
