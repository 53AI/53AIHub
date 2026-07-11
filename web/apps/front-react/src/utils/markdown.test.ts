/**
 * splitMarkdownIntoChunks / smartSplitMarkdown 的回归测试
 *
 * 复现的场景：跨行 HTML 注释 `<!-- ... -->` 中的内容被切到多个 chunk，
 * 渲染器（如 vditor）见不到完整的 `<!-- ... -->`，把 `<text>` 等标签显示到界面上。
 */
import { describe, expect, it } from "vitest";

import { smartSplitMarkdown, splitMarkdownIntoChunks } from "./markdown";

/**
 * 工具：检查单个 chunk 内部的注释配对是否平衡。
 * 暴露出的注释（只有 <!-- 没有 -->）会让 vditor 把后续内容当可见文本渲染。
 */
function balancedComments(chunkContent: string): boolean {
  const opens = (chunkContent.match(/<!--/g) || []).length;
  const closes = (chunkContent.match(/-->/g) || []).length;
  return opens === closes;
}

describe("splitMarkdownIntoChunks — HTML 注释完整性", () => {
  it("跨行的 HTML 注释必须整体保留，不能切碎到多个 chunk", () => {
    const content = [
      "<!-- <description>这是一个跨行的注释，里面有多个 HTML 标签</description>",
      "<text>",
      "牵引车: 一车",
      "拖车: 二车",
      "拖车三车: 三车",
      "</text>",
      "<a>附加标签A</a>",
      "<a>附加标签B</a>",
      "-->",
      "",
      "正文段落后续内容。",
    ].join("\n");

    const chunks = splitMarkdownIntoChunks(content, {
      maxChunkLength: 3000,
      maxChunkLines: 50,
      minChunkLength: 500,
    });

    expect(chunks.length).toBeGreaterThanOrEqual(1);
    for (const chunk of chunks) {
      expect(balancedComments(chunk.content)).toBe(true);
    }
  });

  it("超长 HTML 注释内容也应保持为单一 chunk（不被 splitLongText 横切）", () => {
    // 注释体内字符数超过 3000，强制触发切分逻辑
    const bodyLines = Array.from({ length: 80 }, (_, i) =>
      `<row index="${i}">value ${"x".repeat(40)}</row>`,
    ).join("\n");

    const content = `<!-- <description>超长注释</description>\n${bodyLines}\n-->`;

    const chunks = splitMarkdownIntoChunks(content, {
      maxChunkLength: 3000,
      maxChunkLines: 50,
      minChunkLength: 500,
    });

    for (const chunk of chunks) {
      expect(balancedComments(chunk.content)).toBe(true);
    }
  });
});

describe("smartSplitMarkdown — HTML 注释作为完整 block", () => {
  it("多行 HTML 注释应当被识别为一个完整 block, 而不是按行拆分", () => {
    const content = [
      "<!-- 开始",
      "中间内容行 1",
      "中间内容行 2",
      "结束 -->",
    ].join("\n");

    const blocks = smartSplitMarkdown(content);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toContain("<!-- 开始");
    expect(blocks[0]).toContain("中间内容行 1");
    expect(blocks[0]).toContain("中间内容行 2");
    expect(blocks[0].trimEnd()).toMatch(/-->$/);
  });

  it("单行 HTML 注释应当是单独一个 block", () => {
    const content = "<!-- 简短注释 -->";
    const blocks = smartSplitMarkdown(content);
    expect(blocks).toEqual(["<!-- 简短注释 -->"]);
  });
});

describe("smartSplitMarkdown — 多行 HTML 元素作为完整 block", () => {
  // 跟 HTML 注释同类的 bug: 多行 HTML 元素被按行拆碎,
  // 落到 splitMarkdownIntoChunks 时若被 splitLongText 横切,
  // 渲染器见不到闭合标签, 把中间内容显示到界面上.

  it("<details>...</details> 应当被识别为一个完整 block (空白行分隔)", () => {
    const content = [
      "intro",
      "",
      "<details>",
      "<summary>点击展开</summary>",
      "展开后的内容",
      "</details>",
      "",
      "outro",
    ].join("\n");

    const blocks = smartSplitMarkdown(content);
    // 期望: [intro, <details>完整块, outro] — 3 个
    expect(blocks).toHaveLength(3);
    expect(blocks[1]).toContain("<details>");
    expect(blocks[1]).toContain("<summary>点击展开</summary>");
    expect(blocks[1]).toContain("展开后的内容");
    expect(blocks[1]).toContain("</details>");
  });

  it("<div>...</div> 含嵌套子标签应当被识别为一个完整 block", () => {
    const content = [
      "intro",
      "",
      '<div class="info">',
      "<p>段落一</p>",
      "<p>段落二</p>",
      "</div>",
      "",
      "outro",
    ].join("\n");

    const blocks = smartSplitMarkdown(content);
    expect(blocks).toHaveLength(3);
    expect(blocks[1]).toContain('<div class="info">');
    expect(blocks[1]).toContain("<p>段落一</p>");
    expect(blocks[1]).toContain("<p>段落二</p>");
    expect(blocks[1]).toContain("</div>");
  });

  it("超长的多行 HTML 块在 splitMarkdownIntoChunks 后也不被横切", () => {
    const bigBody = Array.from(
      { length: 80 },
      (_, i) => `<p>row ${i}: ${"x".repeat(40)}</p>`,
    ).join("\n");

    const content = `<div class="big">\n${bigBody}\n</div>\nback to text`;

    const chunks = splitMarkdownIntoChunks(content, {
      maxChunkLength: 3000,
      maxChunkLines: 50,
      minChunkLength: 500,
    });

    // 没有 chunk 应该出现 <div ...> 但缺 </div> 的不平衡
    for (const chunk of chunks) {
      const opens = (chunk.content.match(/<div\b/g) || []).length;
      const closes = (chunk.content.match(/<\/div>/g) || []).length;
      expect(opens).toBe(closes);
    }
  });
});
