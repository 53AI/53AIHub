/**
 * KnowledgeSourceSelector — 动态菜单项 + trigger 文案
 *
 * 关注点:library 模式下,菜单应出现「当前知识库:<name>」项,trigger
 * 在仅选中当前库时显示库名而不是 "1 个"。
 *
 * 注:i18n 文案匹配用 key 后缀形式(`/current_library/i`),避免依赖运行环境的 locale。
 */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { KnowledgeSourceSelector } from "./selector";
import type { KnowledgeSourceState } from "./types";

const baseValue: KnowledgeSourceState = {
  mode: "all",
  allKnowledge: true,
  knowledgeGraph: false,
  networkSearch: false,
  selectedFiles: [],
  selectedLibraries: [],
  selectedSpaces: [],
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("KnowledgeSourceSelector — 动态菜单项", () => {
  it("library.value 非空时,菜单包含「当前知识库:<name>」项", async () => {
    const onChange = vi.fn();
    render(
      <KnowledgeSourceSelector
        value={baseValue}
        onChange={onChange}
        library={{ name: "测试库", value: ["7"] }}
        allowSelectLibrary
      />,
    );

    // 打开下拉
    fireEvent.click(document.querySelector(".knowledge-source-trigger")!);

    await waitFor(() => {
      // 菜单项 label 包含 current_library 文案(任一语言版本匹配)
      expect(document.body.textContent).toMatch(/current\s*library/i);
    });
  });

  it("library.value 为空时,菜单不包含「当前知识库」项", async () => {
    const onChange = vi.fn();
    render(
      <KnowledgeSourceSelector
        value={baseValue}
        onChange={onChange}
        allowSelectLibrary
      />,
    );

    fireEvent.click(document.querySelector(".knowledge-source-trigger")!);

    await waitFor(() => {
      expect(document.querySelector(".ant-dropdown-menu")).toBeTruthy();
    });

    expect(document.body.textContent).not.toMatch(/current\s*library/i);
  });

  it("点击「当前知识库:<name>」触发 onChange:mode='libraries', selectedLibraries 含当前库", async () => {
    const onChange = vi.fn();
    render(
      <KnowledgeSourceSelector
        value={baseValue}
        onChange={onChange}
        library={{ name: "测试库", value: ["7"] }}
        allowSelectLibrary
      />,
    );

    fireEvent.click(document.querySelector(".knowledge-source-trigger")!);

    await waitFor(() => {
      expect(document.body.textContent).toMatch(/current\s*library/i);
    });
    const menuItem = Array.from(document.querySelectorAll(".ant-dropdown-menu-item"))
      .find((el) => /current\s*library/i.test(el.textContent || ""))!;
    act(() => {
      fireEvent.click(menuItem);
    });

    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0]![0] as KnowledgeSourceState;
    expect(next.mode).toBe("libraries");
    expect(next.allKnowledge).toBe(false);
    expect(next.selectedLibraries).toHaveLength(1);
    expect(next.selectedLibraries![0]).toMatchObject({
      id: "7",
      name: "测试库",
      islibrary: true,
    });
  });

  it("trigger 文案:仅选中当前库时显示库名而不是 '1 个'", () => {
    const onChange = vi.fn();
    const { container } = render(
      <KnowledgeSourceSelector
        value={{
          ...baseValue,
          mode: "libraries",
          allKnowledge: false,
          selectedLibraries: [{ id: "7", name: "测试库", icon: "folder-icon" }],
        }}
        onChange={onChange}
        library={{ name: "测试库", value: ["7"] }}
        allowSelectLibrary
      />,
    );

    const triggerText = container.querySelector(".knowledge-source-trigger-text")!.textContent;
    expect(triggerText).toBe("测试库");
    // 不应出现 "1 个"
    expect(triggerText).not.toMatch(/1\s*个/);
  });

  it("trigger 文案:allKnowledge=true 时即使存在 library prop,显示「全部知识」而不是库名", () => {
    // 复现 Bug #1:用户从「当前知识库:测试库」切回「全部知识」,trigger 应回到「全部知识」
    const onChange = vi.fn();
    const { container } = render(
      <KnowledgeSourceSelector
        value={{
          ...baseValue,
          mode: "all",
          allKnowledge: true,
          selectedLibraries: [],
        }}
        onChange={onChange}
        library={{ name: "测试库", value: ["7"] }}
        allowSelectLibrary
      />,
    );

    const triggerText = container.querySelector(".knowledge-source-trigger-text")!.textContent;
    // 不应再显示当前库的 name
    expect(triggerText).not.toBe("测试库");
    // 应回到「全部知识」(i18n key)
    expect(triggerText).toMatch(/all\s*knowledge/i);
  });

  it("点击「当前知识库」写入的 selectedLibraries[0].icon 来自 library.icon prop(不是从旧 state 取)", async () => {
    // 复现 Bug #2:用户先选「全部知识」→ selectedLibraries 为空 → 再点「当前知识库」,
    // 旧实现从 value.selectedLibraries?.[0]?.icon 取值,会拿到 undefined。
    const onChange = vi.fn();
    render(
      <KnowledgeSourceSelector
        value={{
          ...baseValue,
          mode: "all",
          allKnowledge: true,
          selectedLibraries: [],  // 空 -> 旧 bug 路径
        }}
        onChange={onChange}
        library={{ name: "测试库", icon: "library-card", value: ["7"] }}
        allowSelectLibrary
      />,
    );

    fireEvent.click(document.querySelector(".knowledge-source-trigger")!);
    await waitFor(() => {
      expect(document.body.textContent).toMatch(/current\s*library/i);
    });
    const menuItem = Array.from(document.querySelectorAll(".ant-dropdown-menu-item"))
      .find((el) => /current\s*library/i.test(el.textContent || ""))!;
    act(() => {
      fireEvent.click(menuItem);
    });

    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0]![0] as KnowledgeSourceState;
    expect(next.selectedLibraries?.[0]?.icon).toBe("library-card");
  });
});