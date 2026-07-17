import { SearchOutlined } from "@ant-design/icons";
import { Search } from "@km/shared-components-react";
import { Input, Pagination, Select } from "antd";
import { useEffect, useMemo, useState } from "react";
import { t } from "@/locales";
import { useIsSoftStyle } from "@/stores/modules/enterprise";
import { useSkillsStore } from "@/stores/modules/skills";
import SkillList from "./SkillList";

const PAGINATED_PAGE_SIZE = 9;

interface MyListProps {
  /** 启用分页：固定 9 条/页，仅显示上一页/下一页按钮（无页码） */
  paginated?: boolean;
}

export function MyList({ paginated = false }: MyListProps = {}) {
  const skillsStore = useSkillsStore();
  const isSoftStyle = useIsSoftStyle();
  const [keyword, setKeyword] = useState("");
  const [sort, setSort] = useState<"created_time" | "updated_time">(
    "created_time",
  );
  const [page, setPage] = useState(1);

  useEffect(() => {
    skillsStore.loadMySkillList(true);
  }, []);

  const sortOptions = useMemo(
    () => [
      {
        label: t("agent.sort_by_created_time"),
        value: "created_time" as const,
      },
      {
        label: t("agent.sort_by_updated_time"),
        value: "updated_time" as const,
      },
    ],
    [],
  );

  const showAgentList = useMemo(() => {
    return skillsStore.mySkillList;
  }, [skillsStore.mySkillList]);

  // 分页模式：与 SkillList 内部 keyword 过滤保持一致（sort 仅排序，不影响条数）
  const filteredCount = useMemo(() => {
    if (!paginated) return 0;
    const kw = keyword.trim().toLowerCase();
    if (!kw) return showAgentList.length;
    return showAgentList.filter(
      (item) =>
        item.display_name.toLowerCase().includes(kw) ||
        item.skill_name.toLowerCase().includes(kw) ||
        item.description.toLowerCase().includes(kw),
    ).length;
  }, [paginated, showAgentList, keyword]);

  const totalPages = Math.max(
    1,
    Math.ceil(filteredCount / PAGINATED_PAGE_SIZE),
  );

  // 切换排序或关键词时回到第 1 页
  // biome-ignore lint/correctness/useExhaustiveDependencies: 切换 sort/keyword 时需重置 page
  useEffect(() => {
    setPage(1);
  }, [sort, keyword]);

  // 当前页越界时回到第 1 页
  useEffect(() => {
    if (page > totalPages) setPage(1);
  }, [page, totalPages]);

  return (
    <div>
      {/* Header with sticky position */}
      <div className="bg-white">
        <div className="flex md:flex-row flex-col-reverse gap-5 items-stretch md:items-center justify-between bg-white py-1 mb-4">
          <div className="flex items-center gap-2 w-[200px]">
            <Select
              prefix={t("module.time") + "："}
              value={sort}
              onChange={setSort}
              className="flex-none"
            >
              {sortOptions.map((opt) => (
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
              placeholder={t("action.search") + t("module.skill")}
            />
            <Input
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              size="large"
              className="w-full md:hidden el-input--main"
              placeholder={t("action.search") + t("module.skill")}
              prefix={<SearchOutlined />}
            />
          </div>
        </div>
      </div>
      <SkillList
        loading={skillsStore.mySkillLoading}
        keyword={keyword}
        list={showAgentList}
        sort={sort}
        type="my"
        page={paginated ? page : undefined}
        pageSize={paginated ? PAGINATED_PAGE_SIZE : undefined}
        className={`grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 ${isSoftStyle ? "mt-2 " : "my-3"}`}
      />
      {paginated && (
        <div className="flex justify-end py-4">
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
