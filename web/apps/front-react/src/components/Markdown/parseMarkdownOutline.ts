export interface OutlineChunkItem {
  id: number;
  content: string;
}

export interface OutlineNode {
  text: string;
  level: number;
  children: OutlineNode[];
  chunkIndex: number;
  id: string;
}

const HEADING_PATTERN = /^(#{1,6})\s+(.+)$/;
const FENCE_PATTERN = /^```(\w*)/;
const INLINE_MD_LINK_PATTERN = /\[([^\]]*)\]\(([^)]*)\)/g;

export const generateHeadingId = (chunkIndex: number, headingIndex: number): string => {
  return `heading-${chunkIndex}-${headingIndex}`;
};

// 目录是纯文本展示位,直接还原链接文本。
// 标题里出现链接的 url 带括号/转义 ] 的概率极低,采用 CommonMark 的简化字符类,
const stripInlineMarkdownLinks = (raw: string): string => {
  return raw.replace(INLINE_MD_LINK_PATTERN, "$1");
};

export const parseMarkdownOutline = (
  chunks: OutlineChunkItem[],
  idGenerator: (chunkIndex: number, headingIndex: number) => string = generateHeadingId,
): OutlineNode[] => {
  const tree: OutlineNode[] = [];
  const stack: OutlineNode[] = [];

  chunks.forEach((chunk, chunkIndex) => {
    if (typeof chunk.content !== "string") return;
    const lines = chunk.content.split("\n");
    let inCodeBlock = false;
    let headingIndex = 0;

    for (const line of lines) {
      if (FENCE_PATTERN.test(line)) {
        inCodeBlock = !inCodeBlock;
        continue;
      }

      if (inCodeBlock) continue;

      const match = line.match(HEADING_PATTERN);
      if (!match) continue;

      const level = match[1].length;
      const text = stripInlineMarkdownLinks(match[2].trim());

      const id = idGenerator(chunkIndex, headingIndex++);

      const node: OutlineNode = {
        text,
        level,
        children: [],
        chunkIndex,
        id,
      };

      while (stack.length > 0 && stack[stack.length - 1].level >= level) {
        stack.pop();
      }

      if (stack.length === 0) {
        tree.push(node);
      } else {
        stack[stack.length - 1].children.push(node);
      }

      stack.push(node);
    }
  });

  return tree;
};
