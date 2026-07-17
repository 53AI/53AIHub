import { SearchOutlined } from "@ant-design/icons";
import { Search as SearchInput, Tabs } from "@km/shared-components-react";
import { Input, Pagination } from "antd";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useListState } from "@/hooks";
import { t } from "@/locales";
import { useIsSoftStyle } from "@/stores/modules/enterprise";
import { useSkillsStore } from "@/stores/modules/skills";
import { isLoggedIn, showLoginModal } from "@/utils/permission";
import SkillList from "./SkillList";

const PAGINATED_PAGE_SIZE = 9;

/**
 * URL 持久化状态（使用 snake_case key 以兼容既有 ?group_id= URL）
 */
interface ExploreState {
  group_id: number;
  keyword: string;
}

interface GroupListProps {
  onAdd?: (id: string) => void;
  /** 是否启用 URL 参数同步，由父级页面（index.tsx）显式开启 */
  enableUrlSync?: boolean;
  /** 启用分页：固定 9 条/页，仅显示上一页/下一页按钮（无页码） */
  paginated?: boolean;
  /** 是否启用 sticky 定位，默认 true */
  sticky?: boolean;
  /** 直接添加到指定 agentId，不弹出选择小助理弹窗 */
  addedAgentId?: number | string;
  /** 已添加的技能 ID 列表，用于在弹窗中标记已添加状态 */
  addedSkillIds?: string[];
  /** 使用技能回调（将技能添加到对话框） */
  onUseSkill?: (skill: {
    id: string;
    display_name: string;
    skill_name: string;
    icon?: string;
  }) => void;
  /** 初始 group_id，用于弹窗场景保持上次选中的 tab */
  initialGroupId?: number;
}

export function GroupList({
  onAdd,
  sticky = true,
  addedAgentId,
  addedSkillIds,
  onUseSkill,
  enableUrlSync = false,
  paginated = false,
	initialGroupId = 0,
}: GroupListProps) {
  const skillsStore = useSkillsStore();
  const isSoftStyle = useIsSoftStyle();

	// 筛选状态（URL 持久化由 enableUrlSync 控制，默认关闭）
	const defaultState = useMemo<ExploreState>(
		() => ({
			group_id: initialGroupId,
			keyword: "",
		}),
		[initialGroupId],
	);
	const { state, updateState } = useListState<ExploreState>(defaultState, {
		enableUrlSync,
	});

  // 有缓存则静默刷新，无缓存则显示骨架屏
  const [loading, setLoading] = useState(!skillsStore.skillList.length);

  // 页面离开时清除缓存，确保下次进入时加载最新数据
  useEffect(() => {
    if (skillsStore.skillList.length === 0) {
      setLoading(true);
    }
    skillsStore.loadSkillList().finally(() => setLoading(false));

    return () => {
      skillsStore.clearSkillListCache();
    };
  }, []);

  const showSkillList = useMemo(() => {
    return skillsStore.skillList;
  }, [skillsStore.skillList]);

  // 分页模式：与 SkillList 内部 keyword 过滤保持一致，用于计算总页数
  const filteredCount = useMemo(() => {
    if (!paginated) return 0;
    const kw = state.keyword.trim().toLowerCase();
    if (!kw) return showSkillList.length;
    return showSkillList.filter(
      (item) =>
        item.display_name.toLowerCase().includes(kw) ||
        item.skill_name.toLowerCase().includes(kw) ||
        item.description.toLowerCase().includes(kw),
    ).length;
  }, [paginated, showSkillList, state.keyword]);

  const totalPages = Math.max(
    1,
    Math.ceil(filteredCount / PAGINATED_PAGE_SIZE),
  );

  const [page, setPage] = useState(1);

  // 切换分组时回到第 1 页
  // biome-ignore lint/correctness/useExhaustiveDependencies: 切换 group_id 时需重置 page
  useEffect(() => {
    setPage(1);
  }, [state.group_id]);

  // 当前页越界（例如 keyword 变化后总数变少）时回到第 1 页
  useEffect(() => {
    if (page > totalPages) setPage(1);
  }, [page, totalPages]);

  const tabItems = useMemo(() => {
    return skillsStore.categorys.map((cat) => ({
      key: String(cat.group_id),
      label: cat.group_name,
    }));
  }, [skillsStore.categorys]);

  const handleTabChange = useCallback(
    async (key: string) => {
      if (!isLoggedIn()) {
        showLoginModal();
      }
      const group_id = Number(key);
      updateState({ group_id });
      if (!isLoggedIn()) return;
      setLoading(true);
      try {
        await skillsStore.loadSkillList({
          group_id: group_id || undefined,
          isRefresh: true,
        });
      } finally {
        setLoading(false);
      }
    },
    [skillsStore, updateState],
  );

  const handleSearchFocus = () => {
    if (!isLoggedIn()) {
      showLoginModal();
    }
  };

  return (
    <div>
      <div
        className={`${sticky ? "sticky z-[100]" : ""} bg-white`}
        style={{ top: isSoftStyle ? "120px" : "30px" }}
      >
        <div className="flex md:flex-row flex-col-reverse gap-5 items-stretch md:items-center justify-between bg-white py-1">
          <Tabs
            items={tabItems}
            activeKey={String(state.group_id)}
            onChange={handleTabChange}
            className="flex-1 index-tabs overflow-hidden"
          />
          <div className="w-full md:w-auto">
            <SearchInput
              value={state.keyword}
              onDebouncedChange={(val) => updateState({ keyword: val })}
              onFocus={handleSearchFocus}
              className="hidden md:flex"
              placeholder={t("action.search") + t("module.skill")}
            />
            <Input
              value={state.keyword}
              onChange={(e) => updateState({ keyword: e.target.value })}
              onFocus={handleSearchFocus}
              size="large"
              className="w-full md:hidden el-input--main"
              placeholder={t("action.search") + t("module.skill")}
              prefix={<SearchOutlined />}
            />
          </div>
        </div>
      </div>

      <SkillList
        loading={loading}
        keyword={state.keyword}
        list={showSkillList}
        type="explore"
        groupId={state.group_id}
        page={paginated ? page : undefined}
        pageSize={paginated ? PAGINATED_PAGE_SIZE : undefined}
        className={`${isSoftStyle ? "mt-2" : "my-3"}`}
        onAdd={onAdd}
        addedAgentId={addedAgentId}
        addedSkillIds={addedSkillIds}
        onUseSkill={onUseSkill}
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

export default GroupList;
