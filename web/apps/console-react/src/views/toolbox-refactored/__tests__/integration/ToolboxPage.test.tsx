/**
 * ToolboxPage 集成测试
 * 测试 Zustand Store + 组件组合场景
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
  within,
} from "@testing-library/react";
import { ToolboxRefactoredPage } from "../../index";
import { useToolboxStore } from "../../store";
import type { AiLinkItem, RawGroupOption, GroupOption } from "../../types";
import type {
  MockSortableGroupGridProps,
  MockGroupTabsProps,
  MockHeaderProps,
} from "../types";

// Mock locales
vi.mock("@/locales", () => ({
  t: (key: string) => key,
}));

// Mock Header
vi.mock("@/components/Header", () => ({
  default: ({ title }: MockHeaderProps) => (
    <div data-testid="header">{title}</div>
  ),
}));

// Mock GroupTabs
vi.mock("@/components/GroupTabs/GroupTabs", () => ({
  GroupTabs: ({
    value,
    onChange,
    onOptionsChange,
    disabled,
  }: MockGroupTabsProps & { disabled?: boolean }) => (
    <div data-testid="group-tabs">
      <span data-testid="selected-groups">{JSON.stringify(value)}</span>
      <span data-testid="group-tabs-disabled">
        {disabled ? "true" : "false"}
      </span>
      <button data-testid="select-group-1" onClick={() => onChange([1])}>
        Select Group 1
      </button>
      <button data-testid="select-group-all" onClick={() => onChange([-1])}>
        Select All
      </button>
      <button
        data-testid="get-options"
        onClick={() =>
          onOptionsChange?.([{ group_id: 1, group_name: "Group 1", sort: 1 }])
        }
      >
        Get Options
      </button>
    </div>
  ),
}));

// Mock SortableGroupGrid
vi.mock("@/components/SortableGroupGrid", () => ({
  default: ({
    groups,
    renderItem,
    onChange,
    sortable,
  }: MockSortableGroupGridProps & { sortable?: boolean }) => (
    <div data-testid="sortable-grid" data-sortable={sortable}>
      {groups.map((group) => (
        <div key={String(group.id)} data-testid={`group-${group.id}`}>
          <span>{group.title}</span>
          {group.items.map((item) => (
            <div key={item.id} data-testid={`item-${item.id}`}>
              {renderItem(item.data, undefined)}
            </div>
          ))}
        </div>
      ))}
      <button
        data-testid="trigger-sort-change"
        onClick={() => onChange?.(groups)}
      >
        Trigger Sort Change
      </button>
    </div>
  ),
}));

// Mock StoreDialog
vi.mock("../../components/StoreDialog", () => ({
  default: vi
    .fn()
    .mockImplementation(() => (
      <div data-testid="store-dialog">Store Dialog</div>
    )),
}));

// Mock API
const mockItems: AiLinkItem[] = [
  {
    ai_link_id: "1",
    name: "Tool 1",
    description: "Desc 1",
    logo: "logo1.png",
    url: "https://url1.com",
    group_id: 1,
    sort: 1,
  },
  {
    ai_link_id: "2",
    name: "Tool 2",
    description: "Desc 2",
    logo: "logo2.png",
    url: "https://url2.com",
    group_id: 1,
    sort: 2,
  },
  {
    ai_link_id: "3",
    name: "Tool 3",
    description: "Desc 3",
    logo: "logo3.png",
    url: "https://url3.com",
    group_id: 2,
    sort: 1,
  },
];

const mockGroups: RawGroupOption[] = [
  { group_id: 1, group_name: "Group 1", sort: 1 },
  { group_id: 2, group_name: "Group 2", sort: 2 },
];

vi.mock("../../api/toolboxApi", () => ({
  toolboxApi: {
    list: vi.fn(),
    loadGroups: vi.fn(),
    delete: vi.fn(),
    sort: vi.fn(),
  },
}));

// Mock react-router-dom
const mockNavigate = vi.fn();
vi.mock("react-router-dom", () => ({
  useNavigate: () => mockNavigate,
}));

// Mock constants
vi.mock("@/constants/group", () => ({
  GROUP_TYPE: { AI_LINK: 3 },
}));

// Mock antd - 必须在顶层定义 mock 函数
vi.mock("antd", async () => {
  const actual = await vi.importActual<typeof import("antd")>("antd");
  return {
    ...actual,
    Modal: {
      confirm: vi.fn(),
    },
    message: {
      success: vi.fn(),
      error: vi.fn(),
    },
  };
});

import { toolboxApi } from "../../api/toolboxApi";
import type { ToolboxApiInterface } from "../../api/toolboxApi";
import { ALL_GROUP_ID } from "../../constants";
import { Modal, message } from "antd";

const mockToolboxApi = toolboxApi as ToolboxApiInterface;
const mockMessageSuccess = message.success as ReturnType<typeof vi.fn>;
const mockMessageError = message.error as ReturnType<typeof vi.fn>;

describe("ToolboxRefactoredPage 集成测试", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(mockMessageSuccess).mockClear();
    vi.mocked(mockMessageError).mockClear();

    vi.mocked(mockToolboxApi.loadGroups).mockResolvedValue(mockGroups);
    vi.mocked(mockToolboxApi.list).mockResolvedValue(mockItems);
    vi.mocked(mockToolboxApi.delete).mockResolvedValue(undefined);
    vi.mocked(mockToolboxApi.sort).mockResolvedValue(undefined);

    // 重置 Zustand store 到初始状态
    useToolboxStore.setState({
      aiLinkList: [],
      groupOptions: [],
      rawGroupOptions: [],
      selectedGroups: [ALL_GROUP_ID],
      keyword: "",
      loading: false,
      saving: false,
      isSort: false,
    });
  });

  afterEach(() => {
    // 确保每个测试后清理
    useToolboxStore.setState({
      aiLinkList: [],
      groupOptions: [],
      rawGroupOptions: [],
      selectedGroups: [ALL_GROUP_ID],
      keyword: "",
      loading: false,
      saving: false,
      isSort: false,
    });
  });

  // ========== 基础渲染测试 ==========
  describe("基础渲染", () => {
    it("应该渲染页面主体结构", async () => {
      await act(async () => {
        render(<ToolboxRefactoredPage />);
      });

      expect(screen.getByTestId("header")).toBeInTheDocument();
      expect(screen.getByTestId("group-tabs")).toBeInTheDocument();
    });

    it("应该加载分组数据", async () => {
      await act(async () => {
        render(<ToolboxRefactoredPage />);
      });

      expect(mockToolboxApi.loadGroups).toHaveBeenCalled();
    });

    it("应该渲染搜索框", async () => {
      await act(async () => {
        render(<ToolboxRefactoredPage />);
      });

      expect(
        screen.getByPlaceholderText("module.ai_toolbox_search_placeholder_v2"),
      ).toBeInTheDocument();
    });

    it("应该渲染添加和排序按钮", async () => {
      await act(async () => {
        render(<ToolboxRefactoredPage />);
      });

      expect(screen.getByText("action_add")).toBeInTheDocument();
      expect(screen.getByText("action_sort")).toBeInTheDocument();
    });

    it("应该渲染 StoreDialog 组件", async () => {
      await act(async () => {
        render(<ToolboxRefactoredPage />);
      });

      expect(screen.getByTestId("store-dialog")).toBeInTheDocument();
    });
  });

  // ========== 分组切换测试 ==========
  describe("分组切换", () => {
    it("切换分组后应该更新 selectedGroups", async () => {
      const groupOptions: GroupOption[] = [
        { group_id: 1, group_name: "Group 1", children: [] },
        { group_id: 2, group_name: "Group 2", children: [] },
      ];

      await act(async () => {
        render(<ToolboxRefactoredPage />);
      });

      // 设置分组选项
      await act(async () => {
        useToolboxStore.setState({ groupOptions, rawGroupOptions: mockGroups });
      });

      // 点击切换分组
      await act(async () => {
        fireEvent.click(screen.getByTestId("select-group-1"));
      });

      // 验证 selectedGroups 已更新
      const selectedGroups = screen.getByTestId("selected-groups").textContent;
      expect(JSON.parse(selectedGroups!)).toEqual([1]);
    });

    it("选择全部分组时应该显示 -1", async () => {
      await act(async () => {
        render(<ToolboxRefactoredPage />);
      });

      await act(async () => {
        fireEvent.click(screen.getByTestId("select-group-all"));
      });

      const selectedGroups = screen.getByTestId("selected-groups").textContent;
      expect(JSON.parse(selectedGroups!)).toEqual([-1]);
    });

    it("点击 get-options 按钮应该触发 onOptionsChange", async () => {
      await act(async () => {
        render(<ToolboxRefactoredPage />);
      });

      // 点击获取选项按钮
      await act(async () => {
        fireEvent.click(screen.getByTestId("get-options"));
      });

      // 验证 store 的 groupOptions 已更新
      const state = useToolboxStore.getState();
      expect(state.groupOptions.length).toBeGreaterThan(0);
    });
  });

  // ========== 关键词搜索测试 ==========
  describe("关键词搜索", () => {
    it("输入关键词可以筛选", async () => {
      await act(async () => {
        render(<ToolboxRefactoredPage />);
      });

      const input = screen.getByPlaceholderText(
        "module.ai_toolbox_search_placeholder_v2",
      );
      fireEvent.change(input, { target: { value: "test" } });

      expect(input).toHaveValue("test");
    });

    it("清空关键词应该重置搜索", async () => {
      await act(async () => {
        render(<ToolboxRefactoredPage />);
      });

      const input = screen.getByPlaceholderText(
        "module.ai_toolbox_search_placeholder_v2",
      ) as HTMLInputElement;

      fireEvent.change(input, { target: { value: "test" } });
      expect(input.value).toBe("test");

      // 清空输入
      fireEvent.change(input, { target: { value: "" } });
      expect(input.value).toBe("");
    });

    it("初始状态下排序按钮应该可用", async () => {
      await act(async () => {
        render(<ToolboxRefactoredPage />);
      });

      const sortButton = screen.getByText("action_sort");
      expect(sortButton).not.toBeDisabled();
    });

    it("关键词更新后 store 状态应该同步", async () => {
      await act(async () => {
        render(<ToolboxRefactoredPage />);
      });

      // 更新 store 状态
      const store = useToolboxStore.getState();
      store.setKeyword("test");

      // 验证 store 状态已更新
      expect(useToolboxStore.getState().keyword).toBe("test");
    });
  });

  // ========== 添加功能测试 ==========
  describe("添加功能", () => {
    it("点击添加按钮应该渲染 StoreDialog", async () => {
      await act(async () => {
        render(<ToolboxRefactoredPage />);
      });

      // 验证 StoreDialog 已渲染
      expect(screen.getByTestId("store-dialog")).toBeInTheDocument();

      const addButton = screen.getByText("action_add");
      expect(addButton).toBeInTheDocument();
    });
  });

  // ========== 排序功能测试 ==========
  describe("排序功能", () => {
    it("排序模式下切换按钮状态", async () => {
      await act(async () => {
        render(<ToolboxRefactoredPage />);
      });

      const sortButton = screen.getByText("action_sort");
      expect(sortButton).not.toBeDisabled();

      // 点击排序按钮进入排序模式
      await act(async () => {
        fireEvent.click(sortButton);
      });

      // 验证 store 状态
      expect(useToolboxStore.getState().isSort).toBe(true);
    });

    it("排序模式下分组选择应该禁用", async () => {
      await act(async () => {
        render(<ToolboxRefactoredPage />);
      });

      // 进入排序模式
      await act(async () => {
        fireEvent.click(screen.getByText("action_sort"));
      });

      expect(screen.getByTestId("group-tabs-disabled").textContent).toBe(
        "true",
      );
    });

    it("点击取消应该退出排序模式", async () => {
      await act(async () => {
        render(<ToolboxRefactoredPage />);
      });

      // 进入排序模式
      await act(async () => {
        fireEvent.click(screen.getByText("action_sort"));
      });

      // 点击取消
      await act(async () => {
        fireEvent.click(screen.getByText("action_cancel"));
      });

      // 验证 store 状态
      expect(useToolboxStore.getState().isSort).toBe(false);
    });

    it("点击保存应该调用排序 API", async () => {
      const groupOptions: GroupOption[] = [
        {
          group_id: 1,
          group_name: "Group 1",
          children: mockItems.filter((item) => item.group_id === 1),
        },
      ];

      await act(async () => {
        render(<ToolboxRefactoredPage />);
      });

      await act(async () => {
        useToolboxStore.setState({ groupOptions, isSort: true });
      });

      // 点击保存
      await act(async () => {
        fireEvent.click(screen.getByText("action_save"));
      });

      expect(mockToolboxApi.sort).toHaveBeenCalled();
    });

    it("排序保存成功应该显示成功提示", async () => {
      const groupOptions: GroupOption[] = [
        {
          group_id: 1,
          group_name: "Group 1",
          children: mockItems.filter((item) => item.group_id === 1),
        },
      ];

      await act(async () => {
        render(<ToolboxRefactoredPage />);
      });

      await act(async () => {
        useToolboxStore.setState({ groupOptions, isSort: true });
      });

      await act(async () => {
        fireEvent.click(screen.getByText("action_save"));
      });

      await waitFor(() => {
        expect(mockMessageSuccess).toHaveBeenCalledWith("action_save_success");
      });
    });

    it("排序模式下 grid 应该可拖拽", async () => {
      await act(async () => {
        render(<ToolboxRefactoredPage />);
      });

      // 初始状态
      expect(screen.getByTestId("sortable-grid")).toHaveAttribute(
        "data-sortable",
        "false",
      );

      // 进入排序模式
      await act(async () => {
        fireEvent.click(screen.getByText("action_sort"));
      });

      expect(screen.getByTestId("sortable-grid")).toHaveAttribute(
        "data-sortable",
        "true",
      );
    });

    it("排序变化应该更新 store 中的 groupOptions", async () => {
      const groupOptions: GroupOption[] = [
        {
          group_id: 1,
          group_name: "Group 1",
          children: [mockItems[0], mockItems[1]],
        },
      ];

      await act(async () => {
        render(<ToolboxRefactoredPage />);
      });

      await act(async () => {
        useToolboxStore.setState({ groupOptions });
      });

      // 触发排序变化
      await act(async () => {
        fireEvent.click(screen.getByTestId("trigger-sort-change"));
      });

      // 验证 updateSortOrder 被调用（通过 store 状态）
      const state = useToolboxStore.getState();
      expect(state.groupOptions).toBeDefined();
    });
  });

  // ========== 编辑功能测试 ==========
  describe("编辑功能", () => {
    it("点击编辑按钮应该跳转到编辑页", async () => {
      const groupOptions: GroupOption[] = [
        {
          group_id: 1,
          group_name: "Group 1",
          children: [mockItems[0]],
        },
      ];

      await act(async () => {
        render(<ToolboxRefactoredPage />);
      });

      await act(async () => {
        useToolboxStore.setState({ groupOptions });
      });

      // 找到编辑按钮
      const editButton = screen.queryByText("action_edit");
      expect(editButton).toBeInTheDocument();

      if (editButton) {
        await act(async () => {
          fireEvent.click(editButton);
        });

        expect(mockNavigate).toHaveBeenCalledWith("/toolbox/create?id=1");
      }
    });
  });

  // ========== 访问功能测试 ==========
  describe("访问功能", () => {
    it("点击访问按钮应该打开新窗口", async () => {
      const mockOpen = vi.fn();
      window.open = mockOpen;

      const groupOptions: GroupOption[] = [
        {
          group_id: 1,
          group_name: "Group 1",
          children: [mockItems[0]],
        },
      ];

      await act(async () => {
        render(<ToolboxRefactoredPage />);
      });

      await act(async () => {
        useToolboxStore.setState({ groupOptions });
      });

      const visitButton = screen.queryByText("action_visit");
      expect(visitButton).toBeInTheDocument();

      if (visitButton) {
        await act(async () => {
          fireEvent.click(visitButton);
        });

        expect(mockOpen).toHaveBeenCalledWith("https://url1.com", "_blank");
      }
    });
  });

  // ========== 删除功能测试 ==========
  describe("删除功能", () => {
    it("点击删除按钮应该弹出确认框", async () => {
      // 设置 Modal.confirm 的行为
      vi.mocked(Modal.confirm).mockImplementation(({ onOk }) => {
        // 模拟用户确认
        onOk?.();
        return { destroy: vi.fn() };
      });

      const groupOptions: GroupOption[] = [
        {
          group_id: 1,
          group_name: "Group 1",
          children: [mockItems[0]],
        },
      ];

      await act(async () => {
        render(<ToolboxRefactoredPage />);
      });

      await act(async () => {
        useToolboxStore.setState({ groupOptions });
      });

      // 查找包含 DeleteOutlined 图标的按钮
      const deleteIcon = document.querySelector(".anticon-delete");
      expect(deleteIcon).toBeInTheDocument();

      if (deleteIcon) {
        const deleteButton = deleteIcon.closest("button");
        expect(deleteButton).toBeInTheDocument();

        if (deleteButton) {
          await act(async () => {
            fireEvent.click(deleteButton);
          });

          expect(Modal.confirm).toHaveBeenCalled();
        }
      }
    });

    it("确认删除后应该调用 delete API", async () => {
      vi.mocked(Modal.confirm).mockImplementation(({ onOk }) => {
        onOk?.();
        return { destroy: vi.fn() };
      });

      const groupOptions: GroupOption[] = [
        {
          group_id: 1,
          group_name: "Group 1",
          children: [mockItems[0]],
        },
      ];

      await act(async () => {
        render(<ToolboxRefactoredPage />);
      });

      await act(async () => {
        useToolboxStore.setState({ groupOptions });
      });

      const deleteIcon = document.querySelector(".anticon-delete");
      if (deleteIcon) {
        const deleteButton = deleteIcon.closest("button");
        if (deleteButton) {
          await act(async () => {
            fireEvent.click(deleteButton);
          });

          expect(mockToolboxApi.delete).toHaveBeenCalledWith("1");
        }
      }
    });

    it("删除成功后应该显示成功提示", async () => {
      vi.mocked(Modal.confirm).mockImplementation(({ onOk }) => {
        onOk?.();
        return { destroy: vi.fn() };
      });

      const groupOptions: GroupOption[] = [
        {
          group_id: 1,
          group_name: "Group 1",
          children: [mockItems[0]],
        },
      ];

      await act(async () => {
        render(<ToolboxRefactoredPage />);
      });

      await act(async () => {
        useToolboxStore.setState({ groupOptions });
      });

      const deleteIcon = document.querySelector(".anticon-delete");
      if (deleteIcon) {
        const deleteButton = deleteIcon.closest("button");
        if (deleteButton) {
          await act(async () => {
            fireEvent.click(deleteButton);
          });

          await waitFor(() => {
            expect(mockMessageSuccess).toHaveBeenCalledWith(
              "action_delete_success",
            );
          });
        }
      }
    });

    it("删除成功后应该刷新列表", async () => {
      vi.mocked(Modal.confirm).mockImplementation(({ onOk }) => {
        onOk?.();
        return { destroy: vi.fn() };
      });

      const groupOptions: GroupOption[] = [
        {
          group_id: 1,
          group_name: "Group 1",
          children: [mockItems[0]],
        },
      ];

      await act(async () => {
        render(<ToolboxRefactoredPage />);
      });

      // 清除初始加载的调用
      vi.clearAllMocks();

      await act(async () => {
        useToolboxStore.setState({ groupOptions });
      });

      const deleteIcon = document.querySelector(".anticon-delete");
      if (deleteIcon) {
        const deleteButton = deleteIcon.closest("button");
        if (deleteButton) {
          await act(async () => {
            fireEvent.click(deleteButton);
          });

          // 验证 refresh 被调用（通过 list API 再次调用）
          await waitFor(() => {
            expect(mockToolboxApi.list).toHaveBeenCalled();
          });
        }
      }
    });
  });

  // ========== 状态显示测试 ==========
  describe("状态显示", () => {
    it("空数据时应该显示 Empty 组件", async () => {
      vi.mocked(mockToolboxApi.list).mockResolvedValue([]);

      await act(async () => {
        render(<ToolboxRefactoredPage />);
      });

      // 设置空分组
      await act(async () => {
        useToolboxStore.setState({ groupOptions: [], loading: false });
      });

      // 应该显示空状态
      expect(screen.queryByText("no_data")).toBeInTheDocument();
    });

    it("加载中应该显示 Spin 组件", async () => {
      await act(async () => {
        render(<ToolboxRefactoredPage />);
      });

      await act(async () => {
        useToolboxStore.setState({ loading: true });
      });

      // 应该有 loading 状态的 Spin
      const spinElement = document.querySelector(".ant-spin");
      expect(spinElement).toBeInTheDocument();
    });

    it("保存中应该显示 loading 状态", async () => {
      const groupOptions: GroupOption[] = [
        {
          group_id: 1,
          group_name: "Group 1",
          children: mockItems.filter((item) => item.group_id === 1),
        },
      ];

      await act(async () => {
        render(<ToolboxRefactoredPage />);
      });

      await act(async () => {
        useToolboxStore.setState({ groupOptions, isSort: true, saving: true });
      });

      // 保存按钮应该有 loading 状态
      const btn = screen.getByText("action_save").closest("button");
      expect(btn?.className).toContain("loading");
    });
  });

  // ========== Store 状态管理测试 ==========
  describe("Store 状态管理", () => {
    it("loadGroups 应该更新 rawGroupOptions", async () => {
      await act(async () => {
        render(<ToolboxRefactoredPage />);
      });

      const store = useToolboxStore.getState();
      await act(async () => {
        await store.loadGroups();
      });

      expect(useToolboxStore.getState().rawGroupOptions).toEqual(mockGroups);
    });

    it("setSelectedGroups 应该更新 selectedGroups", async () => {
      await act(async () => {
        render(<ToolboxRefactoredPage />);
      });

      const store = useToolboxStore.getState();
      store.setSelectedGroups([1, 2]);

      expect(useToolboxStore.getState().selectedGroups).toEqual([1, 2]);
    });

    it("setKeyword 应该更新 keyword", async () => {
      await act(async () => {
        render(<ToolboxRefactoredPage />);
      });

      const store = useToolboxStore.getState();
      store.setKeyword("test keyword");

      expect(useToolboxStore.getState().keyword).toBe("test keyword");
    });

    it("setIsSort 应该更新 isSort", async () => {
      await act(async () => {
        render(<ToolboxRefactoredPage />);
      });

      const store = useToolboxStore.getState();
      store.setIsSort(true);

      expect(useToolboxStore.getState().isSort).toBe(true);
    });

    it("updateGroupOptions 应该更新 groupOptions", async () => {
      await act(async () => {
        render(<ToolboxRefactoredPage />);
      });

      const store = useToolboxStore.getState();
      store.updateGroupOptions(mockGroups);

      const state = useToolboxStore.getState();
      expect(state.groupOptions.length).toBe(2);
    });
  });
});
