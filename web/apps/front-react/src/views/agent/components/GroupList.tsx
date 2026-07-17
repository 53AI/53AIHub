import { SearchOutlined } from "@ant-design/icons";
import { Search, Tabs } from "@km/shared-components-react";
import { Input, Pagination } from "antd";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { t } from "@/locales";
import { useAgentStore } from "@/stores/modules/agent";
import { useIsSoftStyle } from "@/stores/modules/enterprise";
import { isLoggedIn, showLoginModal } from "@/utils/permission";
import AgentList from "./AgentList";

const PAGINATED_PAGE_SIZE = 9;

interface GroupListProps {
  sticky?: boolean;
  selectMode?: boolean;
  flatMode?: boolean;
  canView?: boolean;
  /** 启用分页：固定 9 条/页，仅显示上一页/下一页按钮（无页码） */
  paginated?: boolean;
  /** 选中 Agent 时的回调（透传给卡片，用于关闭外层 Modal 等） */
  onSelect?: () => void;
}

export function GroupList({
  sticky = true,
  canView = true,
  selectMode = false,
  flatMode = false,
  paginated = false,
  onSelect,
}: GroupListProps) {
  const [keyword, setKeyword] = useState("");
  const [groupId, setGroupId] = useState(0);
  const [page, setPage] = useState(1);

  // 新增：读取 URL 参数
  const [searchParams, setSearchParams] = useSearchParams();

  const agentStore = useAgentStore();
  const isSoftStyle = useIsSoftStyle();

  // 有缓存则静默刷新，无缓存则显示骨架屏
  const [loading, setLoading] = useState(!agentStore.agentList.length);

  useEffect(() => {
    if (agentStore.agentList.length === 0) {
      setLoading(true);
    }
    Promise.all([
      agentStore.loadCategorys(),
      agentStore.loadAgentList(),
    ]).finally(() => setLoading(false));
  }, []);

  // 新增：响应 URL 参数变化选中分组
  useEffect(() => {
    const groupIdParam = searchParams.get("group_id");
    if (groupIdParam) {
      const id = Number(groupIdParam);
      // 验证：必须是有效数字且 >= 0，且要么是 0（全部），要么存在于分组列表中
      if (!isNaN(id) && id >= 0) {
        const exists =
          id === 0 || agentStore.categorys.some((cat) => cat.group_id === id);
        if (exists) {
          setGroupId(id);
        }
      }
    }
  }, [searchParams, agentStore.categorys]);

  const showAgentList = useMemo(() => {
    const list =
      groupId === 0
        ? agentStore.agentList
        : agentStore.agentList.filter((item) => item.group_id === groupId);
    return list;
  }, [agentStore.agentList, groupId]);

  // 分页模式：基于关键词过滤后的总条数计算总页数（AgentList 内部已应用 keyword）
  const totalPages = Math.max(
    1,
    Math.ceil(showAgentList.length / PAGINATED_PAGE_SIZE),
  );

  // 切换分组时回到第 1 页
  // biome-ignore lint/correctness/useExhaustiveDependencies: 切换 groupId 时需重置 page
  useEffect(() => {
    setPage(1);
  }, [groupId]);

  // 当前页越界（例如筛选后总数变少）时自动回到第 1 页
  useEffect(() => {
    if (page > totalPages) setPage(1);
  }, [page, totalPages]);

  const tabItems = useMemo(
    () =>
      agentStore.categorys.map((cat) => ({
        key: String(cat.group_id),
        label: cat.group_name,
      })),
    [agentStore.categorys],
  );

  const handleTabChange = (key: string) => {
    if (!isLoggedIn()) {
      showLoginModal();
    }
    setGroupId(Number(key));
    const newParams = new URLSearchParams(searchParams);
    if (key === "0") {
      newParams.delete("group_id");
    } else {
      newParams.set("group_id", key);
    }
    setSearchParams(newParams, { replace: true });
  };

  const handleSearchFocus = () => {
    if (!isLoggedIn()) {
      showLoginModal();
    }
  };

  const listClassName = flatMode
    ? `flex flex-col gap-2 ${isSoftStyle ? "mt-2" : "my-3"}`
    : `grid grid-cols-3 gap-4 ${isSoftStyle ? "mt-4 " : "my-3"}`;

  return (
    <div>
      <div
        className={`${selectMode ? "" : sticky ? "sticky z-[100]" : ""} bg-white`}
        style={{ top: isSoftStyle ? "120px" : "30px" }}
      >
        <div className="flex md:flex-row flex-col-reverse gap-5 items-stretch md:items-center justify-between bg-white py-1">
          <Tabs
            items={tabItems}
            activeKey={String(groupId)}
            onChange={handleTabChange}
            className="flex-1 index-tabs overflow-hidden"
          />
          <div className="w-full md:w-auto">
            <Search
              value={keyword}
              onDebouncedChange={setKeyword}
              onFocus={handleSearchFocus}
              className="hidden md:flex"
              placeholder={t("action.search") + t("module.agent")}
            />
            <Input
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              onFocus={handleSearchFocus}
              size="large"
              className="w-full md:hidden el-input--main"
              placeholder={t("action.search") + t("module.agent")}
              prefix={<SearchOutlined />}
            />
          </div>
        </div>
      </div>
      <AgentList
        type="explore"
        loading={loading}
        keyword={keyword}
        list={showAgentList}
        canView={canView}
        groupId={groupId}
        selectMode={selectMode}
        flatMode={flatMode}
        page={paginated ? page : undefined}
        pageSize={paginated ? PAGINATED_PAGE_SIZE : undefined}
        className={listClassName}
        onSelect={onSelect}
      />
      {paginated && (
        <div className="flex justify-end pt-4">
          <Pagination
            current={page}
            pageSize={PAGINATED_PAGE_SIZE}
            total={showAgentList.length}
            onChange={(p) => setPage(p)}
            showSizeChanger={false}
            showTotal={(total) => t("el.pagination.total", { total })}
          />
        </div>
      )}
    </div>
  );
}

export default GroupList;
