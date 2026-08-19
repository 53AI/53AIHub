/**
 * EnhancedMentionDropdown —— @ popover 搜索态的三条交互约束:
 *   1. 搜索无结果时展示空态
 *   2. 搜索 loading 时不与列表同时展示
 *   3. 搜索态下隐藏底部的「@ 选择指定内容」等入口
 *
 * 入口收编为 2 个:`onOpenLibrary`(知识库) + `onOpenMyFiles`(我的文件)。
 * version / recordingConfig 守卫由调用方负责,本组件不感知。
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { EnhancedMentionDropdown } from "./EnhancedMentionDropdown";

vi.mock("@/utils/version", () => ({ checkVersion: () => true }));
vi.mock("@/locales", () => ({ t: (key: string) => key }));

const DOC = { id: "1", name: "季度报告.docx", icon: "" } as any;

function renderDropdown(props: Record<string, unknown> = {}) {
  return render(
    <EnhancedMentionDropdown
      suggestions={[]}
      recentList={[DOC]}
      searchKeyword=""
      searchLoading={false}
      selectedIndex={-1}
      onSelect={vi.fn()}
      onSearchChange={vi.fn()}
      onClose={vi.fn()}
      style={{}}
      hasKnowledgeBase
      onOpenLibrary={vi.fn()}
      onOpenMyFiles={vi.fn()}
      {...(props as any)}
    />,
  );
}

describe("EnhancedMentionDropdown 搜索态", () => {
  it("搜索无结果时展示空态", () => {
    renderDropdown({ searchKeyword: "找不到的文件", suggestions: [], searchLoading: false });

    expect(screen.getByText("chat.mention.search_no_result")).toBeInTheDocument();
  });

  // 回归:接口 results=null → suggestions=[] 时,不得回落展示「最近访问」的文件
  it("搜索结果为空时不展示最近访问列表", () => {
    renderDropdown({
      searchKeyword: "找不到的文件",
      suggestions: [],
      recentList: [DOC],
      searchLoading: false,
    });

    expect(screen.queryByText("季度报告.docx")).not.toBeInTheDocument();
    expect(screen.getByText("chat.mention.search_no_result")).toBeInTheDocument();
  });

  it("搜索 loading 时只展示 loading,不展示上一次关键词的列表", () => {
    // suggestions 仍是上一次搜索的残留结果
    renderDropdown({ searchKeyword: "季度", suggestions: [DOC], searchLoading: true });

    expect(screen.getByText("chat.mention.searching")).toBeInTheDocument();
    expect(screen.queryByText("季度报告.docx")).not.toBeInTheDocument();
  });

  it("搜索态下隐藏底部入口", () => {
    renderDropdown({ searchKeyword: "季度", suggestions: [DOC], searchLoading: false });

    expect(screen.queryByText(/chat.select_from_knowledge/)).not.toBeInTheDocument();
    expect(screen.queryByText(/chat.select_from_my/)).not.toBeInTheDocument();
  });

  it("非搜索态展示最近访问与底部入口", () => {
    renderDropdown();

    expect(screen.getByText("季度报告.docx")).toBeInTheDocument();
    expect(screen.getByText(/chat.select_from_knowledge/)).toBeInTheDocument();
    expect(screen.getByText(/chat.select_from_my/)).toBeInTheDocument();
  });

  // 回归:Esc 必须调 onCancel(把 chip 还原成普通字符),而不是仅调 onClose(只关弹窗)。
  // 之前漏掉这条路径,@ 弹窗里按 Esc 后 chip 仍以 mention-input 形式留在 DOM 里。
  it("Esc 优先调 onCancel,fallback 到 onClose", () => {
    const onCancel = vi.fn();
    const onClose = vi.fn();
    const { container } = renderDropdown({ onCancel, onClose });

    const dropdown = container.querySelector(".enhanced-mention-dropdown") as HTMLElement;
    expect(dropdown).not.toBeNull();

    dropdown.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
    );

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("没传 onCancel 时 Esc fallback 到 onClose(向后兼容)", () => {
    const onClose = vi.fn();
    const { container } = renderDropdown({ onCancel: undefined, onClose });

    const dropdown = container.querySelector(".enhanced-mention-dropdown") as HTMLElement;
    dropdown.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
    );

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("EnhancedMentionDropdown 入口可见性", () => {
  it("传 onOpenLibrary 时显示「从知识库里选择」入口", () => {
    renderDropdown({ onOpenLibrary: vi.fn() });

    expect(screen.getByText(/chat.select_from_knowledge/)).toBeInTheDocument();
  });

  it("未传 onOpenLibrary 时隐藏「从知识库里选择」入口", () => {
    renderDropdown({ onOpenLibrary: undefined });

    expect(screen.queryByText(/chat.select_from_knowledge/)).not.toBeInTheDocument();
  });

  it("传 onOpenMyFiles 时显示「从我的中选择」入口", () => {
    renderDropdown({ onOpenMyFiles: vi.fn() });

    expect(screen.getByText(/chat.select_from_my/)).toBeInTheDocument();
  });

  // 回归:knowledge 模式复用本组件时不传 onOpenMyFiles → 自动隐藏入口
  it("未传 onOpenMyFiles 时隐藏「从我的中选择」入口(knowledge 模式)", () => {
    renderDropdown({ onOpenMyFiles: undefined });

    expect(screen.queryByText(/chat.select_from_my/)).not.toBeInTheDocument();
  });
});