import { describe, expect, it } from "vitest";
import React from "react";
import { shouldBubbleAssistantSkipRender } from "./assistant-memo";
import type { BubbleAssistantProps } from "./assistant";

function makeBaseProps(overrides: Partial<BubbleAssistantProps> = {}): BubbleAssistantProps {
  return {
    content: "",
    streaming: false,
    reasoning: "",
    showError: false,
    menu: undefined,
    error: undefined,
    header: undefined,
    footer: undefined,
    suggestions: [],
    alwaysShowMenu: false,
    ...overrides,
  };
}

describe("shouldBubbleAssistantSkipRender", () => {
  it("returns false when header React element reference changes (e.g., new processRecords during streaming)", () => {
    // BubbleAssistant 的 header prop 包裹 ProcessFlowHeader。
    // 流式阶段父组件可能仅 message.process_records 更新（content 未变），
    // 但 memo 不能因此跳过渲染，否则 ProcessFlowHeader 会停留在旧的 processRecords 数据。
    // 父组件应当通过 useMemo 稳定 header JSX 引用，未变则跳过渲染；
    // 一旦 header 引用变了，memo 必须重新渲染以反映新数据。
    const prev = makeBaseProps({
      content: "hello",
      header: React.createElement("div", null, "header-a"),
    });
    const next = makeBaseProps({
      content: "hello",
      header: React.createElement("div", null, "header-b"),
    });

    expect(shouldBubbleAssistantSkipRender(prev, next)).toBe(false);
  });

  it("returns true when header React element reference is stable", () => {
    const stableHeader = React.createElement("div", null, "header");
    const prev = makeBaseProps({ header: stableHeader });
    const next = makeBaseProps({ header: stableHeader });
    expect(shouldBubbleAssistantSkipRender(prev, next)).toBe(true);
  });

  it("returns false when footer React element reference changes", () => {
    const prev = makeBaseProps({
      footer: React.createElement("div", null, "footer-a"),
    });
    const next = makeBaseProps({
      footer: React.createElement("div", null, "footer-b"),
    });
    expect(shouldBubbleAssistantSkipRender(prev, next)).toBe(false);
  });

  it("returns false when menu React element reference changes", () => {
    const prev = makeBaseProps({
      menu: React.createElement("div", null, "menu-a"),
    });
    const next = makeBaseProps({
      menu: React.createElement("div", null, "menu-b"),
    });
    expect(shouldBubbleAssistantSkipRender(prev, next)).toBe(false);
  });

  it("returns false when error React element reference changes", () => {
    const prev = makeBaseProps({
      error: React.createElement("div", null, "error-a"),
    });
    const next = makeBaseProps({
      error: React.createElement("div", null, "error-b"),
    });
    expect(shouldBubbleAssistantSkipRender(prev, next)).toBe(false);
  });

  it("returns false when content changes", () => {
    const prev = makeBaseProps({ content: "before" });
    const next = makeBaseProps({ content: "after" });
    expect(shouldBubbleAssistantSkipRender(prev, next)).toBe(false);
  });

  it("returns false when streaming flips", () => {
    const prev = makeBaseProps({ streaming: false });
    const next = makeBaseProps({ streaming: true });
    expect(shouldBubbleAssistantSkipRender(prev, next)).toBe(false);
  });

  it("returns false when reasoning changes", () => {
    const prev = makeBaseProps({ reasoning: "old" });
    const next = makeBaseProps({ reasoning: "new" });
    expect(shouldBubbleAssistantSkipRender(prev, next)).toBe(false);
  });

  it("returns false when showError flips", () => {
    const prev = makeBaseProps({ showError: false });
    const next = makeBaseProps({ showError: true });
    expect(shouldBubbleAssistantSkipRender(prev, next)).toBe(false);
  });

  it("returns false when alwaysShowMenu flips", () => {
    const prev = makeBaseProps({ alwaysShowMenu: false });
    const next = makeBaseProps({ alwaysShowMenu: true });
    expect(shouldBubbleAssistantSkipRender(prev, next)).toBe(false);
  });

  it("returns false when suggestions reference changes", () => {
    const prev = makeBaseProps({ suggestions: [{ id: 1, content: "a" }] });
    const next = makeBaseProps({ suggestions: [{ id: 2, content: "b" }] });
    expect(shouldBubbleAssistantSkipRender(prev, next)).toBe(false);
  });

  it("returns true when suggestions reference is stable", () => {
    const stableSuggestions = [{ id: 1, content: "a" }];
    const prev = makeBaseProps({ suggestions: stableSuggestions });
    const next = makeBaseProps({ suggestions: stableSuggestions });
    expect(shouldBubbleAssistantSkipRender(prev, next)).toBe(true);
  });

  it("returns true when both sides have no React elements", () => {
    const prev = makeBaseProps({ content: "same" });
    const next = makeBaseProps({ content: "same" });
    expect(shouldBubbleAssistantSkipRender(prev, next)).toBe(true);
  });
});