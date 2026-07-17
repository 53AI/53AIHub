import type { ToolLessonItem } from '@/api/modules/memory/types';
/**
 * 记忆相关工具函数
 */

// 预编译正则表达式，避免每次循环重新创建
const PATTERNS = {
  codeBlock: /^```/,
  heading: /^(#{1,6})\s+/,
  unorderedList: /^(\*|-)\s+/,
  orderedList: /^\d+\.\s+/,
} as const;

/**
 * 添加内容段，如果有当前标题则合并
 */
const addSection = (
  sections: string[],
  currentHeading: string | null,
  content: string
): string | null => {
  if (currentHeading) {
    sections.push(`${currentHeading}\n${content}`);
    return null; // 清除标题，后续段落不再带标题
  }
  sections.push(content);
  return currentHeading;
};

/**
 * 按标题和段落分割 Markdown 内容
 * - 标题 + 第一个段落/列表 合并为一个 fact
 * - 无序列表项单独作为独立 fact
 * - 有序列表项单独作为独立 fact
 * - 后续段落各自作为独立 fact
 * - 无标题的段落/列表独立作为 fact
 */
export function splitByHeadings(content: string): string[] {
  const lines = content.split('\n');
  const sections: string[] = [];
  let currentHeading: string | null = null;
  let currentParagraph: string[] = [];
  let inCodeBlock = false;

  const flushParagraph = () => {
    const paragraph = currentParagraph.join('\n').trim();
    if (!paragraph) {
      currentParagraph = [];
      return;
    }

    currentHeading = addSection(sections, currentHeading, paragraph);
    currentParagraph = [];
  };

  for (const line of lines) {
    // 检测代码块
    if (PATTERNS.codeBlock.test(line)) {
      inCodeBlock = !inCodeBlock;
      currentParagraph.push(line);
      continue;
    }
    if (inCodeBlock) {
      currentParagraph.push(line);
      continue;
    }

    // 检测标题行
    if (PATTERNS.heading.test(line)) {
      flushParagraph();
      currentHeading = line.trim();
      continue;
    }

    // 检测列表行（无序或有序）- 合并处理逻辑
    const isListLine = PATTERNS.unorderedList.test(line) || PATTERNS.orderedList.test(line);
    if (isListLine) {
      flushParagraph();
      // 列表项单独作为 fact，如果有标题则合并
      currentHeading = addSection(sections, currentHeading, line.trim());
      continue;
    }

    // 检测空行（段落分隔）
    if (line.trim() === '') {
      flushParagraph();
      continue;
    }

    // 普通正文行
    currentParagraph.push(line);
  }

  // 刷新最后的段落
  flushParagraph();

  // 如果只剩标题没有内容，也要保存
  if (currentHeading) {
    sections.push(currentHeading);
  }

  return sections;
}

// 格式化工具教训内容
export const formatToolLessons = (lessons: ToolLessonItem[]): string => {
  // 检查是否有任何条目包含 category 或 tool_name
  const hasCategory = lessons.some(item => item.category);
  const hasToolName = lessons.some(item => item.tool_name);

  // 如果都没有，直接拼接 lesson
  if (!hasCategory && !hasToolName) {
    return lessons.map(item => item.lesson || '').filter(Boolean).join('\n\n');
  }

  // 按 category 分组
  const grouped = new Map<string, ToolLessonItem[]>();
  const noCategory: ToolLessonItem[] = [];

  lessons.forEach(item => {
    if (item.category) {
      if (!grouped.has(item.category)) {
        grouped.set(item.category, []);
      }
      grouped.get(item.category)!.push(item);
    } else {
      noCategory.push(item);
    }
  });

  const parts: string[] = [];

  // 处理有 category 的分组
  grouped.forEach((items, category) => {
    parts.push(`* **${category}**`);
    let toolIndex = 0;
    items.forEach(item => {
      if (item.tool_name) {
        toolIndex++;
        parts.push(`${toolIndex}. ${item.tool_name}: ${item.lesson}`);
      } else {
        parts.push(`${toolIndex}. ${item.lesson}`);
      }
    });
  });

  // 处理没有 category 的条目
  if (noCategory.length > 0) {
    if (grouped.size > 0) {
      // 如果有分类组，添加一个未分类的标题
      parts.push(`* **其他**`);
    }
    let toolIndex = 0;
    noCategory.forEach(item => {
      if (item.tool_name) {
        toolIndex++;
        parts.push(`${toolIndex}. ${item.tool_name}: ${item.lesson}`);
      } else {
        parts.push(`${toolIndex}. ${item.lesson}`);
      }
    });
  }

  return parts.join('\n\n');
};