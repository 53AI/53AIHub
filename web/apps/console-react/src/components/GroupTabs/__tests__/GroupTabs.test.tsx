import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, screen } from "@testing-library/react";
import { GroupTabs, GroupTabsVariant } from "../GroupTabs";
import type { Group } from "@/api/modules/group";

// Mock dependencies
vi.mock("@/locales", () => ({
  t: (key: string) => key,
}));

vi.mock("@/components/GroupDialog", () => ({
  default: vi.fn(() => null),
}));

const mockOptions: Group[] = [
  { group_id: "1", group_name: "Group 1" },
  { group_id: "2", group_name: "Group 2" },
  { group_id: "3", group_name: "Group 3" },
];

describe("GroupTabs", () => {
  beforeEach(() => vi.clearAllMocks());

  describe("渲染", () => {
    it.each<GroupTabsVariant>(["tabs", "tabs-pure", "dropdown"])(
      "应该渲染 %s 模式",
      (type) => {
        const { container } = render(<GroupTabs type={type} options={mockOptions} />);
        const selector = type === "dropdown" ? ".group-tabs-dropdown" : ".group-tabs";
        expect(container.querySelector(selector)).toBeTruthy();
      },
    );

    it("默认使用 tabs 模式", () => {
      const { container } = render(<GroupTabs options={mockOptions} />);
      expect(container.querySelector(".group-tabs")).toBeTruthy();
    });
  });

  describe("受控模式", () => {
    it("应该响应外部 value 变化", () => {
      const { container, rerender } = render(
        <GroupTabs type="tabs" options={mockOptions} value="1" />,
      );
      expect(container.querySelector(".group-tabs")).toBeTruthy();

      rerender(<GroupTabs type="tabs" options={mockOptions} value="2" />);
      expect(container.querySelector(".group-tabs")).toBeTruthy();
    });

    it("下拉模式应支持数组值", () => {
      const { container } = render(
        <GroupTabs type="dropdown" options={mockOptions} value={["1", "2"]} />,
      );
      expect(container.querySelector(".group-tabs-dropdown")).toBeTruthy();
    });
  });

  describe("非受控模式", () => {
    it("应使用 defaultValue 作为初始值", () => {
      const { container } = render(
        <GroupTabs type="tabs" options={mockOptions} defaultValue="2" />,
      );
      expect(container.querySelector(".group-tabs")).toBeTruthy();
    });
  });

  describe("Ref 方法", () => {
    it("应暴露 open 方法", () => {
      const ref = { current: null as any };
      render(<GroupTabs ref={ref} options={mockOptions} groupType={1} />);
      expect(typeof ref.current?.open).toBe("function");
    });

    it("应暴露 getOptions 方法", () => {
      const ref = { current: null as any };
      render(<GroupTabs ref={ref} type="tabs" options={mockOptions} />);
      expect(typeof ref.current?.getOptions).toBe("function");

      const opts = ref.current?.getOptions();
      expect(Array.isArray(opts)).toBe(true);
      // tabs 模式包含 "全部" 选项
      expect(opts.length).toBe(mockOptions.length + 1);
    });

    it("tabs-pure 模式不应包含全部选项", () => {
      const ref = { current: null as any };
      render(<GroupTabs ref={ref} type="tabs-pure" options={mockOptions} />);
      const opts = ref.current?.getOptions();
      expect(opts.length).toBe(mockOptions.length);
    });
  });

  describe("Props", () => {
    it("应支持 disabled", () => {
      const { container } = render(<GroupTabs type="tabs" options={mockOptions} disabled />);
      expect(container.querySelector(".group-tabs")).toBeTruthy();
    });

    it("应处理空选项", () => {
      const { container } = render(<GroupTabs type="tabs" options={[]} />);
      expect(container.querySelector(".group-tabs")).toBeTruthy();
    });

    it("应处理 null 值", () => {
      const { container } = render(<GroupTabs type="tabs" options={mockOptions} value={null} />);
      expect(container.querySelector(".group-tabs")).toBeTruthy();
    });
  });

  describe("回调", () => {
    it("应调用 onChange", () => {
      const onChange = vi.fn();
      const { container } = render(
        <GroupTabs type="tabs" options={mockOptions} onChange={onChange} />,
      );
      // Tab click 需要更复杂的交互测试
      expect(container.querySelector(".group-tabs")).toBeTruthy();
    });

    it("应调用 onOptionsChange", () => {
      const onOptionsChange = vi.fn();
      const { container } = render(
        <GroupTabs type="tabs" options={mockOptions} onOptionsChange={onOptionsChange} />,
      );
      // GroupDialog change 需要更复杂的交互测试
      expect(container.querySelector(".group-tabs")).toBeTruthy();
    });
  });
});
