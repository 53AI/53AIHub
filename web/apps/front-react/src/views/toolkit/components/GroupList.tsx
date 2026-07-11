import { useState, useEffect, useMemo } from "react";
import { Input } from "antd";
import { Search as SearchInput, Tabs } from "@km/shared-components-react";
import { SearchOutlined } from "@ant-design/icons";
import { useLinksStore } from "@/stores/modules/links";
import { t } from "@/locales";
import { useIsSoftStyle } from "@/stores/modules/enterprise";
import { scrollToElement } from "@km/shared-utils";
import { useListState } from "@/hooks";
import { showLoginModal, isLoggedIn } from "@/utils/permission";
import ListView from "./List";

/**
 * URL 持久化状态（snake_case key 兼容既有 ?group_id= URL）
 */
interface ExploreState {
  group_id: number;
  keyword: string;
}

interface ExploreToolkitProps {
  stickyOffset?: number;
  /** 是否启用 URL 参数同步，由父级页面（index.tsx）显式开启 */
  enableUrlSync?: boolean;
}

export function GroupList({
  stickyOffset = 0,
  enableUrlSync = false,
}: ExploreToolkitProps) {
  const linksStore = useLinksStore();
  const isSoftStyle = useIsSoftStyle();

  // 筛选状态（URL 持久化由 enableUrlSync 控制，默认关闭）
  const defaultState = useMemo<ExploreState>(
    () => ({
      group_id: 0,
      keyword: "",
    }),
    [],
  );
  const { state, updateState } = useListState<ExploreState>(defaultState, {
    enableUrlSync,
  });

  // 有缓存则静默刷新，无缓存则显示骨架屏
  const [loading, setLoading] = useState(!linksStore.links.length);

  useEffect(() => {
    if (linksStore.links.length === 0) {
      setLoading(true);
    }
    Promise.all([
      linksStore.loadCategorys(),
      linksStore.loadLinks(),
    ]).finally(() => setLoading(false));
  }, []);

  const categorys = linksStore.categorys || [];

  const links = (linksStore.links || []).filter((item) => {
    if (state.group_id === 0) return true;
    return item.group_id === state.group_id;
  });

  const tabItems = categorys.map((item) => ({
    key: String(item.group_id),
    label: item.group_name,
  }));

  const handleTabChange = (key: string) => {
    if (!isLoggedIn()) {
      showLoginModal();
    }
    updateState({ group_id: Number(key) });
    scrollToElement(`#group_${key}`, (stickyOffset || 0) + 150);
  };

  const handleSearchFocus = () => {
    if (!isLoggedIn()) {
      showLoginModal();
    }
  };

  return (
    <>
      <div
        className="sticky z-[100] bg-white"
        style={{ top: isSoftStyle ? "120px" : "30px" }}
      >
        <div className="flex md:flex-row flex-col-reverse gap-5 items-stretch md:items-center justify-between bg-white py-1">
          <Tabs
            activeKey={String(state.group_id)}
            onChange={handleTabChange}
            items={tabItems}
            className="flex-1 overflow-hidden toolkit-tabs"
          />
          <div className="w-full md:w-auto">
            <SearchInput
              className="hidden md:flex"
              value={state.keyword}
              onDebouncedChange={(val) => updateState({ keyword: val })}
              onFocus={handleSearchFocus}
              placeholder={t("action.search") + t("module.toolbox")}
            />
            <Input
              value={state.keyword}
              onChange={(e) => updateState({ keyword: e.target.value })}
              onFocus={handleSearchFocus}
              placeholder={t("toolbox.search_placeholder")}
              prefix={<SearchOutlined className="text-gray-400" />}
              className="w-full md:hidden"
              allowClear
              size="large"
            />
          </div>
        </div>
      </div>
      <ListView
        className={`grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 ${isSoftStyle ? "mt-3 mb-16" : "my-3"}`}
        keyword={state.keyword}
        list={links}
        groupId={state.group_id}
        loading={loading}
      />
    </>
  );
}

export default GroupList;