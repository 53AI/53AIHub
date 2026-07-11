import { SearchOutlined } from "@ant-design/icons";
import { Search } from "@km/shared-components-react";
import { Input, Pagination, Select } from "antd";
import { useEffect, useMemo, useState } from "react";
import { t } from "@/locales";
import { useAgentStore } from "@/stores/modules/agent";
import { useIsSoftStyle } from "@/stores/modules/enterprise";
import AgentList from "./AgentList";

const PAGINATED_PAGE_SIZE = 9;

interface MyListProps {
  className?: string;
  selectMode?: boolean;
  flatMode?: boolean;
  canView?: boolean;
  /** 启用分页：固定 9 条/页，仅显示上一页/下一页按钮（无页码） */
  paginated?: boolean;
  /** 选中 Agent 时的回调（透传给卡片，用于关闭外层 Modal 等） */
  onSelect?: () => void;
}

// 常量定义，移到组件外部
const SORT_OPTIONS = [
  { label: t("agent.sort_by_created_time"), value: "created_time" as const },
  { label: t("agent.sort_by_updated_time"), value: "updated_time" as const },
];

export function MyList({
  className,
  selectMode = false,
  flatMode = false,
  canView = true,
  paginated = false,
  onSelect,
}: MyListProps) {
  const [keyword, setKeyword] = useState("");
  const [sort, setSort] = useState<"created_time" | "updated_time">(
    "created_time",
  );
  const [page, setPage] = useState(1);

  const agentStore = useAgentStore();
  const isSoftStyle = useIsSoftStyle();

  useEffect(() => {
    agentStore.loadMyAgentList(true);
  }, []);

  // 与 AgentList 内部过滤逻辑保持一致：先按 sort 排序，再按 keyword 过滤
  // 用于分页模式计算总页数（AgentList 内部完成实际切片）
  const filteredCount = useMemo(() => {
    if (!paginated) return 0;
    const kw = keyword.trim().toLowerCase();
    if (!kw) return agentStore.myAgentList.length;
    return agentStore.myAgentList.filter(
      (item) =>
        item.name.toLowerCase().includes(kw) ||
        item.description?.toLowerCase().includes(kw),
    ).length;
  }, [paginated, agentStore.myAgentList, keyword]);

  const totalPages = Math.max(
    1,
    Math.ceil(filteredCount / PAGINATED_PAGE_SIZE),
  );

  // 切换排序或关键词时回到第 1 页
  // biome-ignore lint/correctness/useExhaustiveDependencies: 切换 sort/keyword 时需重置 page
  useEffect(() => {
    setPage(1);
  }, [sort, keyword]);

  // 当前页越界（例如总数变少）时回到第 1 页
  useEffect(() => {
    if (page > totalPages) setPage(1);
  }, [page, totalPages]);

  const listClassName = flatMode
    ? `flex flex-col gap-2 ${isSoftStyle ? "mt-2 mb-16" : "my-3"}`
    : `grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 ${isSoftStyle ? "mt-2" : "my-3"}`;

  return (
    <div>
      {/* 非选择模式时显示筛选器和搜索框 */}
      {!selectMode && (
        <div className="bg-white">
          <div className="flex md:flex-row flex-col-reverse gap-5 items-stretch md:items-center justify-between bg-white py-1 mb-4">
            <div className="flex items-center gap-2 w-[200px]">
              <Select
                prefix={t("module.time") + "："}
                value={sort}
                onChange={setSort}
                className="flex-none"
              >
                {SORT_OPTIONS.map((opt) => (
                  <Select.Option key={opt.value} value={opt.value}>
                    {opt.label}
                  </Select.Option>
                ))}
              </Select>
            </div>
            <div className="w-full md:w-auto">
              <Search
                value={keyword}
                onDebouncedChange={setKeyword}
                className="hidden md:flex"
                placeholder={t("action.search") + t("module.agent")}
              />
              <Input
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                size="large"
                className="w-full md:hidden el-input--main"
                placeholder={t("action.search") + t("module.agent")}
                prefix={<SearchOutlined />}
              />
            </div>
          </div>
        </div>
      )}

      <AgentList
        type="my"
        keyword={keyword}
        sort={sort}
        selectMode={selectMode}
        flatMode={flatMode}
        canView={canView}
        page={paginated ? page : undefined}
        pageSize={paginated ? PAGINATED_PAGE_SIZE : undefined}
        className={listClassName}
        onRefresh={() => agentStore.loadMyAgentList(true)}
        onSelect={onSelect}
      />
      {paginated && (
        <div className="flex justify-end pt-4">
          <Pagination
            current={page}
            pageSize={PAGINATED_PAGE_SIZE}
            total={filteredCount}
            onChange={(p) => setPage(p)}
            showSizeChanger={false}
            showTotal={(total) => t("el.pagination.total", { total })}
          />
        </div>
      )}
    </div>
  );
}

export default MyList;
