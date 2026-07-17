/**
 * 修复 markdown 表格中「表头单元格数 < 主体行单元格数」导致解析错位的问题。
 *
 * 背景：原 renderer.tsx 内联的版本用正则
 *   /^\|\s*[-:]+(\s*[-:]+)*\s*\|$/
 * 识别分隔行。该正则的 `(\s*[-:]+)*` 与前置 `[-:]+` 在长段 `-` 上会触发
 * 灾难性回溯——单次 .test() 可让浏览器主线程死锁 15+ 秒。
 * test.txt 的分隔行 `|---...---|---...---|`（32+ 个 `-`、两段）会稳定复现。
 *
 * 修复：用 split('|') + 字符判断取代 regex test，O(n) 无回溯。
 */

const SEPARATOR_CHARS = new Set(["-", ":"]);

/** 一行是不是 markdown 表格的分隔行（| --- | :---: | ... |） */
function isSeparatorLine(trimmed: string): boolean {
  if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) return false;
  if (trimmed.length < 3) return false; // 至少 `|x|`

  // 逐段判断：去掉首尾的 | 后用 | 切分，每段必须是空白/-/: 组成且至少一个 -/:
  // 例：`| --- | :---: |` → [" --- ", " :---: "]
  const inner = trimmed.slice(1, -1);
  if (inner.length === 0) return false;
  const segments = inner.split("|");
  if (segments.length === 0) return false;

  let hasDashOrColon = false;
  for (const seg of segments) {
    if (seg.length === 0) continue;
    let segHasSep = false;
    for (let i = 0; i < seg.length; i += 1) {
      const ch = seg[i];
      if (ch === " " || ch === "\t") continue;
      if (SEPARATOR_CHARS.has(ch)) {
        segHasSep = true;
        continue;
      }
      // 出现非空白、非 -/: 字符 → 不是分隔行
      return false;
    }
    if (segHasSep) hasDashOrColon = true;
  }
  return hasDashOrColon;
}

/** 统计一行内的 cell 数（trimmed 后以 | 分隔并去掉空 cell） */
function countCells(trimmed: string): number {
  // 跳过首尾的 |
  const inner = trimmed.slice(1, -1);
  if (inner.length === 0) return 0;

  let cellCount = 0;
  let inCell = false;
  for (let j = 0; j < inner.length; j += 1) {
    if (inner[j] === "|") {
      if (inCell) {
        cellCount += 1;
        inCell = false;
      }
    } else {
      inCell = true;
    }
  }
  if (inCell) cellCount += 1;
  return cellCount;
}

export function fixTableColumns(content: string): string {
  if (!content.includes("|")) return content;

  const lines = content.split("\n");
  const lineCount = lines.length;
  let headerCellCount = 0;
  let maxCellCount = 0;
  let headerLineIndex = -1;
  let separatorLineIndex = -1;

  for (let i = 0; i < lineCount; i += 1) {
    const line = lines[i];
    const trimmed = line.trim();

    // 仅考虑以 | 开头并以 | 结尾的行
    if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) continue;

    if (isSeparatorLine(trimmed)) {
      if (separatorLineIndex === -1) separatorLineIndex = i;
      continue;
    }

    const cellCount = countCells(trimmed);
    if (cellCount === 0) continue;

    if (headerLineIndex === -1) {
      headerCellCount = cellCount;
      headerLineIndex = i;
    } else {
      maxCellCount = Math.max(maxCellCount, cellCount);
    }
  }

  if (
    headerCellCount === 0 ||
    maxCellCount <= headerCellCount ||
    headerLineIndex < 0
  ) {
    return content;
  }

  const cellsToAdd = maxCellCount - headerCellCount;
  // 补齐用的 "cell" 串：原实现的 " |" * N 会在 lastIndexOf("|") 处补一次，
  // 末尾再补一个 "|"，最终单元格比原行多 cellsToAdd 个。
  const emptyCells = " |".repeat(cellsToAdd);
  const emptySeparators = " | ---".repeat(cellsToAdd);

  const fixedLines = lines.map((line, index) => {
    if (index === headerLineIndex) {
      const lastPipeIndex = line.lastIndexOf("|");
      return lastPipeIndex > 0
        ? `${line.substring(0, lastPipeIndex)}${emptyCells} |`
        : line;
    }
    if (index === separatorLineIndex) {
      const lastPipeIndex = line.lastIndexOf("|");
      return lastPipeIndex > 0
        ? `${line.substring(0, lastPipeIndex)}${emptySeparators} |`
        : line;
    }
    return line;
  });

  return fixedLines.join("\n");
}
