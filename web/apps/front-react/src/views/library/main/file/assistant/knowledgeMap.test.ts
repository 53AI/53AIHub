import { describe, expect, it } from "vitest";
import { normalizeKnowledgeMapAnswer } from "./knowledgeMap";

describe("normalizeKnowledgeMapAnswer", () => {
  it("removes parentheses embedded in the mind map root label", () => {
    const answer = [
      "```mermaid",
      "mindmap",
      "  root((【4 技术规范】7 TSG Z8002-2022 特种设备检验人员考核规则(附2023年第1号修改单).pdf.md))",
      "    正文修改",
      "```",
    ].join("\n");

    expect(normalizeKnowledgeMapAnswer(answer)).toContain(
      "root((【4 技术规范】7 TSG Z8002-2022 特种设备检验人员考核规则.pdf.md))",
    );
    expect(normalizeKnowledgeMapAnswer(answer)).toContain("    正文修改");
  });
});
