import { describe, expect, it } from "vitest";
import { parseRegenerateParams } from "./parseRegenerateParams";
import type { Message } from "../types/message";

const baseUserMsg: Message = {
  id: "1",
  role: "user",
  question: "hello world",
};

describe("parseRegenerateParams", () => {
  it("throws TypeError for null message", () => {
    expect(() => parseRegenerateParams(null as any)).toThrow(TypeError);
    expect(() => parseRegenerateParams(undefined as any)).toThrow(TypeError);
  });

  it("returns question as-is when no skill prefix and no options", () => {
    const result = parseRegenerateParams(baseUserMsg);
    expect(result.question).toBe("hello world");
    expect(result.originalQuestion).toBe("hello world");
    expect(result.skill).toBeUndefined();
    expect(result.files).toEqual([]);
    expect(result.specifiedFiles).toEqual([]);
    expect(result.networkSearch).toBe(false);
    expect(result.knowledgeGraph).toBe(false);
    expect(result.sourceMessage).toBe(baseUserMsg);
  });

  it("strips skill prefix when options.skillList provided and hits", () => {
    const msg: Message = { ...baseUserMsg, question: "/translate 你好" };
    const result = parseRegenerateParams(msg, {
      skillList: [{ skill_name: "translate", display_name: "翻译" }],
    });
    expect(result.question).toBe("你好");
    expect(result.skill).toEqual({ skill_name: "translate", display_name: "翻译" });
  });

  it("falls back to message.skill when parseSkillPrefix is false", () => {
    const msg: Message = {
      ...baseUserMsg,
      question: "/translate 你好",
      skill: { skill_name: "translate", display_name: "翻译" },
    };
    const result = parseRegenerateParams(msg, { parseSkillPrefix: false });
    expect(result.question).toBe("/translate 你好");
    expect(result.skill).toEqual({ skill_name: "translate", display_name: "翻译" });
  });

  it("infers networkSearch from rag_stats.type === web_search", () => {
    const msg: Message = {
      ...baseUserMsg,
      rag_stats: { type: "web_search" } as any,
    };
    const result = parseRegenerateParams(msg);
    expect(result.networkSearch).toBe(true);
  });

  it("networkSearch is false for non-web_search type", () => {
    const msg: Message = {
      ...baseUserMsg,
      rag_stats: { type: "knowledge_base" } as any,
    };
    const result = parseRegenerateParams(msg);
    expect(result.networkSearch).toBe(false);
  });

  it("extracts knowledgeGraph from message.knowledge_graph", () => {
    const msg: Message = { ...baseUserMsg, knowledge_graph: true } as any;
    const result = parseRegenerateParams(msg);
    expect(result.knowledgeGraph).toBe(true);
  });

  it("extracts files / specifiedFiles from message", () => {
    const msg: Message = {
      ...baseUserMsg,
      uploaded_files: [{ id: "f1", name: "a.pdf" }] as any,
      specified_files: [{ id: "lib1", islibrary: true }] as any,
    };
    const result = parseRegenerateParams(msg);
    expect(result.files).toHaveLength(1);
    expect(result.files[0]?.id).toBe("f1");
    expect(result.specifiedFiles).toHaveLength(1);
    expect(result.specifiedFiles[0]?.id).toBe("lib1");
  });

  it("uses empty arrays when files/specifiedFiles missing", () => {
    const result = parseRegenerateParams(baseUserMsg);
    expect(result.files).toEqual([]);
    expect(result.specifiedFiles).toEqual([]);
  });

  it("preserves specifiedContent from message", () => {
    const msg: Message = { ...baseUserMsg, specified_content: "ctx" } as any;
    const result = parseRegenerateParams(msg);
    expect(result.specifiedContent).toBe("ctx");
  });
});