import { describe, expect, it } from "vitest";

import { parseMarkdownOutline } from "./parseMarkdownOutline";

describe("parseMarkdownOutline — 标题抽取", () => {
  it("不带链接的标题原样保留", () => {
    const outline = parseMarkdownOutline([{ id: 1, content: "# 纯文本标题" }]);
    expect(outline).toEqual([
      expect.objectContaining({ text: "纯文本标题", level: 1 }),
    ]);
  });

  it("标题包含单个 markdown 链接时,目录只保留链接文本,不显示 URL 与方括号", () => {
    const outline = parseMarkdownOutline([
      {
        id: 1,
        content:
          "## [LLM](?space_id=2G6Y5X&tab=dynamic&sub=list&selected=concept%2Fai-large-model&vd-type=dynamicKnowledge)-Wiki融合方案",
      },
    ]);
    expect(outline).toHaveLength(1);
    expect(outline[0].text).toBe("LLM-Wiki融合方案");
  });

  it("标题包含多个 markdown 链接时,全部剥离为链接文本", () => {
    const outline = parseMarkdownOutline([
      {
        id: 1,
        content:
          "## [LLM](?space_id=2G6Y5X&selected=concept%2Fai-large-model&vd-type=dynamicKnowledge)-Wiki融合方案对齐软件公司[知识空间](?space_id=2G6Y5X&selected=knowledge-space&vd-type=dynamicKnowledge)指引调整说明",
      },
    ]);
    expect(outline).toHaveLength(1);
    expect(outline[0].text).toBe(
      "LLM-Wiki融合方案对齐软件公司知识空间指引调整说明",
    );
  });

  it("不同 level 的标题按嵌套树形结构返回", () => {
    const outline = parseMarkdownOutline([
      { id: 1, content: "# 一级\n## 二级 A\n### 三级\n## 二级 B" },
    ]);
    expect(outline).toHaveLength(1);
    expect(outline[0].level).toBe(1);
    expect(outline[0].children).toHaveLength(2);
    const [childA, childB] = outline[0].children;
    expect(childA.children[0].text).toBe("三级");
    expect(childB.children).toHaveLength(0);
  });

  it("代码块内的 # 不会被识别为标题", () => {
    const outline = parseMarkdownOutline([
      { id: 1, content: "```\n# 注释里的 # 标题\n```\n# 真标题" },
    ]);
    expect(outline).toHaveLength(1);
    expect(outline[0].text).toBe("真标题");
  });

  it("headingIndex 在每个 chunk 内从 0 开始,ID 格式为 heading-{chunkIndex}-{headingIndex}", () => {
    const outline = parseMarkdownOutline([
      { id: 1, content: "# A1\n## A2" },
      { id: 2, content: "# B1" },
    ]);
    const ids = [
      outline[0].id,
      outline[0].children[0].id,
      outline[1].id,
    ];
    expect(ids).toEqual(["heading-0-0", "heading-0-1", "heading-1-0"]);
  });

  it("非字符串 content 的 chunk 跳过,不抛错", () => {
    const outline = parseMarkdownOutline([
      { id: 1, content: undefined as unknown as string },
      { id: 2, content: "# 保留" },
    ]);
    expect(outline).toHaveLength(1);
    expect(outline[0].text).toBe("保留");
  });

  it("7 级及以上 # 不被认为是标题", () => {
    const outline = parseMarkdownOutline([
      { id: 1, content: "###### 合法\n####### 非法" },
    ]);
    expect(outline).toHaveLength(1);
    expect(outline[0].text).toBe("合法");
  });

  it("空字符串 content 返回空 outline", () => {
    const outline = parseMarkdownOutline([{ id: 1, content: "" }]);
    expect(outline).toEqual([]);
  });
});
