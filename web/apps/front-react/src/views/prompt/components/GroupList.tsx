import { useState, useEffect, useMemo } from "react";
import { Input } from "antd";
import { Dropdown } from "@km/shared-components-react";
import { SearchOutlined, DownOutlined } from "@ant-design/icons";
import { Search as SearchInput, Tabs } from "@km/shared-components-react";
import { SvgIcon } from "@km/shared-components-react";
import { usePromptStore } from "@/stores/modules/prompt";
import { useIsSoftStyle } from "@/stores/modules/enterprise";
import { t } from "@/locales";
import PromptList from "./List";
import { useListState } from "@/hooks";
import { showLoginModal, isLoggedIn } from "@/utils/permission";
import "./GroupList.css";

const sortOptions = [
  { key: "default_sort", label: t("prompt.default_sort") },
  { key: "likes_sort", label: t("prompt.likes_sort") },
  { key: "views_sort", label: t("prompt.views_sort") },
];

/**
 * URL 持久化状态（snake_case key 兼容既有 ?group_id= URL）
 */
interface PromptExploreState {
  group_id: number;
  keyword: string;
  sort_type: string;
}

interface GroupListProps {
  /** 是否启用 URL 参数同步，由父级页面（index.tsx）显式开启 */
  enableUrlSync?: boolean;
}

/**
 * @param enableUrlSync 是否启用 URL 参数同步，由父级页面（index.tsx）显式开启
 */
export function GroupList({ enableUrlSync = false }: GroupListProps) {
  const promptStore = usePromptStore();
  const isSoftStyle = useIsSoftStyle();

  // 筛选状态（URL 持久化由 enableUrlSync 控制，默认关闭）
  const defaultState = useMemo<PromptExploreState>(
    () => ({
      group_id: 0,
      keyword: "",
      sort_type: "default_sort",
    }),
    [],
  );
  const { state, updateState } = useListState<PromptExploreState>(defaultState, {
    enableUrlSync,
  });

  // 有缓存则静默刷新，无缓存则显示骨架屏
  const [loading, setLoading] = useState(!promptStore.promptList.length);

  useEffect(() => {
    if (promptStore.promptList.length === 0) {
      setLoading(true);
    }
    Promise.all([
      promptStore.loadCategorys(),
      promptStore.loadPromptList(),
    ]).finally(() => {
      setLoading(false);
    });
  }, []);

  const showPromptList = useMemo(() => {
    let promptList = promptStore.promptList.map((item: any = {}) => {
      item.group_ids = item.group_ids || [];
      const group_options = promptStore.categorys.filter(
        (row: any = {}) =>
          +row.group_id && item.group_ids.includes(row.group_id),
      );
      item.group_names = group_options.map((row: any = {}) => row.group_name);
      return item;
    });

    if (state.sort_type === "likes_sort") {
      promptList = [...promptList].sort(
        (a, b) => (b.likes || 0) - (a.likes || 0),
      );
    } else if (state.sort_type === "views_sort") {
      promptList = [...promptList].sort(
        (a, b) => (b.views || 0) - (a.views || 0),
      );
    }

    const lowerKeyword = state.keyword.toLowerCase().trim();
    if (lowerKeyword) {
      promptList = promptList.filter((item: any) => {
        const matchKeyword = item.name?.toLowerCase().includes(lowerKeyword);
        return (
          (state.group_id === 0 ||
            (+state.group_id &&
              item.group_ids?.includes(state.group_id))) &&
          matchKeyword
        );
      });
    } else {
      promptList =
        state.group_id === 0
          ? promptList
          : promptList.filter(
              (item: any) =>
                +state.group_id && item.group_ids?.includes(state.group_id),
            );
    }

    return promptList;
  }, [
    promptStore.promptList,
    promptStore.categorys,
    state.keyword,
    state.group_id,
    state.sort_type,
  ]);

  const tabItems = useMemo(() => {
    return promptStore.categorys.map((item: any) => ({
      key: String(item.group_id),
      label: item.group_name,
    }));
  }, [promptStore.categorys]);

  const handleSortChange = (value: string) => {
    updateState({ sort_type: value });
  };

  const handleTabChange = (key: string) => {
    if (!isLoggedIn()) {
      showLoginModal();
    }
    updateState({ group_id: Number(key) });
  };

  const handleSearchFocus = () => {
    if (!isLoggedIn()) {
      showLoginModal();
    }
  };

  return (
    <>
      {/* Sticky filter bar */}
      <div
        className="sticky z-[100] bg-white"
        style={{ top: isSoftStyle ? "120px" : "30px" }}
      >
        <div className="flex md:flex-row flex-col-reverse gap-5 items-stretch md:items-center justify-between bg-white py-1">
          <div className="flex-1 md:w-0 flex items-center gap-2">
            <Tabs
              activeKey={String(state.group_id)}
              onChange={handleTabChange}
              items={tabItems}
              className="w-full prompt-tabs md:mb-0 overflow-hidden"
            />
            <Dropdown
              menu={{
                items: sortOptions,
                onClick: ({ key }) => handleSortChange(key),
              }}
            >
              <div className="flex-none md:hidden flex items-center gap-1 text-gray-600 cursor-pointer">
                <SvgIcon name="sort" stroke />
                <span className="text-sm">
                  {sortOptions.find((opt) => opt.key === state.sort_type)?.label}
                </span>
                <DownOutlined style={{ fontSize: 14, color: "#aaa" }} />
              </div>
            </Dropdown>
          </div>
          <div className="w-full md:w-auto flex-none flex md:flex-row-reverse items-center gap-2">
            <SearchInput
              className="flex-none hidden md:flex"
              value={state.keyword}
              onDebouncedChange={(val) => updateState({ keyword: val })}
              onFocus={handleSearchFocus}
              placeholder={t("action.search") + t("module.prompt")}
            />
            <Input
              value={state.keyword}
              onChange={(e) => updateState({ keyword: e.target.value })}
              onFocus={handleSearchFocus}
              placeholder={t("action.search") + t("module.prompt")}
              prefix={<SearchOutlined className="text-gray-400" />}
              className="w-full md:hidden"
              allowClear
              size="large"
            />
            <Dropdown
              menu={{
                items: sortOptions,
                onClick: ({ key }) => handleSortChange(key),
              }}
            >
              <div className="hidden md:flex items-center space-x-1 cursor-pointer text-gray-600">
                <SvgIcon name="sort" stroke size={14} />
                <span className="text-sm">
                  {sortOptions.find((opt) => opt.key === state.sort_type)?.label}
                </span>
                <DownOutlined style={{ fontSize: 14, color: "#aaa" }} />
              </div>
            </Dropdown>
          </div>
        </div>
      </div>

      {/* List */}
      <PromptList
        className={`grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 ${isSoftStyle ? "mt-3 mb-16" : "my-3"}`}
        list={showPromptList}
        keyword={state.keyword}
        groupId={state.group_id}
        loading={loading}
      />
    </>
  );
}

export default GroupList;