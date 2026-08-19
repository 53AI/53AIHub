import React, { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { Dropdown, Spin } from "antd";
import type { MenuProps } from "antd";
import { Loading3QuartersOutlined, CheckOutlined } from "@ant-design/icons";
import { useSearchParams } from "react-router-dom";
import { SvgIcon, Search } from "@km/shared-components-react";
import type {
  WikiPageSortBy,
  WikiPageType,
  WikiPageTypeCounts,
  WikiProgressResponse,
  WikiSortOrder,
} from "@/api/modules/wiki";
import { useSpaceStore } from "@/stores/modules/space";
import { useWikiStore } from "@/stores/modules/wiki";
import { getFormatTimeStamp } from "@km/shared-utils";
import wikiApi from "@/api/modules/wiki";
import permissionsApi from "@/api/modules/permissions";
import {
  PERMISSION_TYPE,
  RESOURCE_TYPE,
  type PermissionType,
} from "@/components/KMPermission/constant";
import { useInfiniteScroll } from "@/hooks/useInfiniteScroll";
import { useUrlEnumState } from "@/hooks/useUrlEnumState";
import { useWikiPageList } from "./useWikiPageList";
import type { ActiveTab } from "./index";
import Breadcrumb from "@/components/Breadcrumb";
import { t } from "@/locales";

type SortType = "alphabetical" | "updated" | "created";

// 前端排序语义 → 后端 sort_by / sort_order
const SORT_FIELD: Record<SortType, { sortBy: WikiPageSortBy; sortOrder: WikiSortOrder }> = {
  alphabetical: { sortBy: "title", sortOrder: "asc" },
  updated: { sortBy: "updated_time", sortOrder: "desc" },
  created: { sortBy: "created_time", sortOrder: "desc" },
};

interface LeftSidebarProps {
  activeTab: ActiveTab;
  setActiveTab: (tab: ActiveTab) => void;
  selectedItemId: string;
  setSelectedItemId: (id: string) => void;
}

const SORT_I18N_KEY: Record<SortType, string> = {
  alphabetical: "wiki.sort.alphabetical",
  updated: "wiki.sort.updated",
  created: "wiki.sort.created",
};

const buildSortMenuItems = (current: SortType): MenuProps["items"] =>
  (Object.keys(SORT_I18N_KEY) as SortType[])
    // 暂时隐藏「字母顺序」选项（保留其逻辑，仅不在下拉中展示）
    .filter((key) => key !== "alphabetical")
    .map((key) => ({
    key,
    label: (
      <div
        className={`min-w-[120px] flex items-center justify-between gap-3 ${
          key === current ? "text-theme" : "text-primary"
        }`}
      >
        <span className="text-sm">{t(SORT_I18N_KEY[key])}</span>
        {key === current && <CheckOutlined className="text-xs" />}
      </div>
    ),
  }));

/**
 * 把 page_type 映射到 i18n key（仅展示后端 page_type_counts 返回的四种类型）
 */
const PAGE_TYPE_I18N_KEY: Record<WikiPageType, string> = {
  concept: "wiki.page_type.concept",
  entity: "wiki.page_type.entity",
  index: "wiki.page_type.index",
  summary: "wiki.page_type.summary",
};

const KNOWN_PAGE_TYPES: WikiPageType[] = ["concept", "entity", "index", "summary"];

// 暂时隐藏右侧排序索引条（A-Z 快速定位 + 排序标签），置为 true 可恢复
const SHOW_SORT_INDEX = false;

const LeftSidebar: React.FC<LeftSidebarProps> = ({
  activeTab,
  setActiveTab,
  selectedItemId,
  setSelectedItemId,
}) => {
  const [searchText, setSearchText] = useState("");
  const [debouncedKeyword, setDebouncedKeyword] = useState("");
  const [sortType, setSortType] = useState<SortType>("updated");
  // 当前页签类型（URL 序列化，支持外部链接直跳到指定类型列表）
  const [activePageType, setActivePageType] = useUrlEnumState<WikiPageType>({
    urlKey: "page_type",
    validValues: KNOWN_PAGE_TYPES,
    defaultValue: KNOWN_PAGE_TYPES[0],
  });
  const [, setSearchParams] = useSearchParams();

  const spaceId = useSpaceStore((state) => state.spaceId);
  const currentSpace = useSpaceStore((state) => state.currentSpace);
  // 共享 pagesData 仍供 RightContent（按 slug 查 pageId）/ 选择器弹窗使用
  const loadPages = useWikiStore((state) => state.loadPages);

  // 标签计数来自索引接口
  const [pageTypeCounts, setPageTypeCounts] = useState<WikiPageTypeCounts | null>(null);

  // 空间文件处理进度
  const [progressData, setProgressData] = useState<WikiProgressResponse | null>(null);

  // 记录上一次的待处理数量
  const prevPendingCountRef = useRef(0);

  // 标记是否已执行过首次滚动定位
  const hasScrolledToSelectedRef = useRef(false);

  // 当前已加载页面的权限缓存：pageId -> 当前用户权限等级
  // 默认视为「有访问权限」，待 myBatch 返回后再决定是否模糊展示摘要
  const [permissionMap, setPermissionMap] = useState<Record<string, PermissionType>>({});

  // 用 ref 拿到最新的 permissionMap，避免在 useEffect 依赖里带上它导致循环
  const permissionMapRef = useRef<Record<string, PermissionType>>({});
  permissionMapRef.current = permissionMap;

  // 防竞态：仅采纳最新一次请求的响应
  const permissionReqIdRef = useRef(0);

  // 搜索关键词防抖由 Search 组件的 onDebouncedChange 提供

  // 服务端驱动的分页列表：标签 / 关键词 / 排序变化自动重置重查
  const {
    items,
    loading,
    hasMore,
    loadMore,
    reload: reloadPages,
  } = useWikiPageList({
    spaceId,
    pageType: activePageType,
    keyword: debouncedKeyword,
    sortBy: SORT_FIELD[sortType].sortBy,
    sortOrder: SORT_FIELD[sortType].sortOrder,
  });

  const { sentinelRef } = useInfiniteScroll({
    hasMore,
    loadingMore: loading,
    onLoadMore: loadMore,
    threshold: 120,
  });

  // 加载标签计数（索引接口）
  const loadCounts = useCallback(async () => {
    if (!spaceId) return;
    try {
      const res = await wikiApi.index(spaceId);
      setPageTypeCounts(res.page_type_counts);
    } catch (err) {
      console.error("[LeftSidebar] index error:", err);
    }
  }, [spaceId]);

  useEffect(() => {
    loadCounts();
  }, [loadCounts]);

  // 计算待处理任务数量（running + not_started），用于显示和轮询
  const pendingCount = useMemo(() => {
    if (!progressData?.items) return 0;
    return progressData.items.filter(
      (item) => item.status === 'running' || item.status === 'not_started'
    ).length;
  }, [progressData]);


  // 加载处理进度的函数
  const loadProgress = useCallback(async () => {
    if (!spaceId) return;
    try {
      const res = await wikiApi.progress(spaceId);
      setProgressData(res);
    } catch (err) {
      console.error('[LeftSidebar] progress error:', err);
    }
  }, [spaceId]);

  // 使用轮询，每10秒请求一次
  // const { start: startPolling, stop: stopPolling } = usePoll(loadProgress, 10000);

  // 初始加载一次
  // useEffect(() => {
  //   loadProgress();
  // }, [loadProgress]);

  // 根据是否有待处理任务启动/停止轮询
  // useEffect(() => {
  //   if (pendingCount > 0) {
  //     startPolling();
  //   } else {
  //     stopPolling();
  //   }
  // }, [pendingCount, startPolling, stopPolling]);

  // 当待处理数量从 > 0 变为 0 时，刷新列表与标签计数
  useEffect(() => {
    if (prevPendingCountRef.current > 0 && pendingCount === 0 && spaceId) {
      // 刷新共享缓存（供 RightContent / 选择器弹窗），并重查侧栏列表与标签计数
      useWikiStore.setState({ pagesSpaceId: "", pagesData: [] });
      loadPages(spaceId);
      reloadPages();
      loadCounts();
    }
    prevPendingCountRef.current = pendingCount;
  }, [pendingCount, spaceId, loadPages, reloadPages, loadCounts]);

  // 按需批量拉取当前可见页面的权限：无权限时摘要需模糊展示
  // 设计：
  //   1) 用 ref 持有最新的 permissionMap，使本 effect 仅以 [items] 作依赖，避免无意义循环
  //   2) reqIdRef 防止快速滚动期间旧响应当作新数据写入
  //   3) 列表清空（切空间 / 切标签）时清空缓存，防止跨空间污染
  useEffect(() => {
    if (items.length === 0) {
      setPermissionMap({});
      return;
    }

    const known = permissionMapRef.current;
    const missing = items.filter((item) => !(item.id in known));
    if (missing.length === 0) return;

    const missingIds = missing.map((item) => item.id);
    const reqId = ++permissionReqIdRef.current;

    permissionsApi
      .myBatch({
        resource_type: RESOURCE_TYPE.wiki_page,
        resource_ids: missingIds,
      })
      .then((batchMap) => {
        if (reqId !== permissionReqIdRef.current) return;
        setPermissionMap((prev) => {
          const next = { ...prev };
          for (const id of missingIds) {
            const key = `${RESOURCE_TYPE.wiki_page}:${id}`;
            // myBatch 未返回视为无权限（与 library/List 行为一致）
            next[id] = batchMap[key] ?? PERMISSION_TYPE.none;
          }
          return next;
        });
      })
      .catch((err) => {
        console.error('[LeftSidebar] wiki page permissions error:', err);
        if (reqId !== permissionReqIdRef.current) return;
        setPermissionMap((prev) => {
          const next = { ...prev };
          for (const id of missingIds) {
            next[id] = PERMISSION_TYPE.none;
          }
          return next;
        });
      });
  }, [items]);

  // 页面列表加载完成后，首次滚动到 selected 对应的项目
  useEffect(() => {
    // 只执行一次
    if (hasScrolledToSelectedRef.current) return;
    if (!selectedItemId || items.length === 0) return;

    // 检查 selectedItemId 是否在列表中
    const exists = items.some((item) => item.slug === selectedItemId);
    if (!exists) return;

    // 标记已执行
    hasScrolledToSelectedRef.current = true;

    // 延迟执行确保 DOM 已渲染
    const timer = setTimeout(() => {
      const element = document.getElementById(`wiki-item-${selectedItemId}`);
      if (element) {
        element.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }, 100);

    return () => clearTimeout(timer);
  }, [selectedItemId, items]);

  // 进入 list 模式但 URL 未指定选中项时，自动选中列表第一项
  // 适用于从知识面板点击「摘要 / 实体 / 概念」卡片进入 wiki 的场景
  useEffect(() => {
    if (activeTab !== "list") return;
    if (selectedItemId) return;
    if (items.length === 0 || loading) return;

    const first = items[0];
    setSelectedItemId(first.slug);
    setSearchParams(
      (prev) => {
        prev.set("selected", first.slug);
        prev.delete("sub");
        prev.delete("vd-type");
        return prev;
      },
      { replace: true },
    );
  }, [activeTab, selectedItemId, items, loading, setSelectedItemId, setSearchParams]);

  // 标签展示：page_type 计数（来自索引接口 page_type_counts）
  const tags = useMemo(() => {
    return KNOWN_PAGE_TYPES.map((k) => ({
      name: t(PAGE_TYPE_I18N_KEY[k]),
      count: pageTypeCounts?.[k] ?? 0,
      key: k,
    }));
  }, [pageTypeCounts]);

  // 搜索态：有关键词时隐藏标签（改为全局搜索）
  const isSearching = searchText.trim().length > 0;

  return (
    <div className="w-[280px] pt-5 h-full flex flex-col border-r border-gray-200 bg-white shrink-0 min-h-0">
      <div className="px-3 flex items-center gap-1 text-sm text-secondary">
        <Breadcrumb
          className="text-sm"
          items={[
            {
              path: `/knowledge`,
              i18nKey: "module.knowledge",
            },
            {
              path: spaceId ? `/knowledge?space_id=${spaceId}` : "/knowledge",
              label: currentSpace?.name ?? t("module.space"),
              linkable: true,
            },
          ]}
        />
      </div>
      <div className="px-3 flex items-center gap-2.5 mt-3">
        <div className="size-[26px] rounded bg-[#E6EEFF] flex items-center justify-center text-theme">
          <SvgIcon name="database-k" />
        </div>
        <div className="text-lg text-primary">{t('module.dynamic_knowledge')}</div>
      </div>

      {/* 搜索框 + 排序按钮：搜索在左，排序下拉触发器在右 */}
      <div className="px-3 flex items-center gap-2 mt-4">
        <Search
          mode="expanded"
          value={searchText}
          onInput={(val) => setSearchText(val)}
          onDebouncedChange={(val) => setDebouncedKeyword(val)}
          placeholder={t("dynamic_knowledge.search_placeholder")}
          className="flex-1 min-w-0"
        />
        {!isSearching && (
          <Dropdown
            menu={{
              items: buildSortMenuItems(sortType),
              onClick: ({ key }) => setSortType(key as SortType),
            }}
            trigger={["click"]}
            placement="bottomRight"
          >
            <div
              className="shrink-0 size-8 flex items-center justify-center rounded-md border  text-[#6B7280] hover:text-blue-500 hover:border-blue-500 hover:bg-gray-50 cursor-pointer"
              title={t(SORT_I18N_KEY[sortType])}
            >
              <SvgIcon name="sort-one" />
            </div>
          </Dropdown>
        )}
      </div>
      {/* 顶部待处理任务提示 */}
      {(pendingCount > 0) && (
        <div className="h-8 bg-[#F3F3F3] text-primary px-3 mx-3 rounded-md text-sm flex items-center gap-2 mt-3">
          {pendingCount > 0 && (
            <>
              <Loading3QuartersOutlined spin style={{ color: "#2563EB" }} />
              <span className="truncate">{t("dynamic_knowledge.queue_pending_tip", { count: pendingCount })}</span>
            </>
          )}
        </div>
      )}
      {/* Tabs (Vertical Menu) */}
      <div className="px-3 mt-3 space-y-2">
        <div
          className={`h-9 flex items-center gap-2 px-3 rounded-md cursor-pointer transition-colors ${activeTab === "index" ? "bg-blue-50 text-theme font-medium" : "text-primary hover:bg-gray-100"}`}
          onClick={() => {
            setSearchParams(
              (prev) => {
                prev.set("sub", "index");
                prev.delete("selected");
                return prev;
              },
              { replace: true },
            );
          }}
        >
          <SvgIcon name="bill" size={17} />
          <span className="text-sm">{t("wiki.page_type.index")}</span>
        </div>
        <div
          className={`h-9 flex items-center gap-2 px-3 rounded-md cursor-pointer transition-colors ${activeTab === "logs" ? "bg-blue-50 text-theme font-medium" : "text-primary hover:bg-gray-100"}`}
          onClick={() => {
            setSearchParams(
              (prev) => {
                prev.set("sub", "logs");
                prev.delete("selected");
                return prev;
              },
              { replace: true },
            );
          }}
        >
          <SvgIcon name="notes" />
          <span className="text-sm">{t("logs.title")}</span>
        </div>
      </div>

      <div className="border-t m-3"></div>
      {/* 标签列表（搜索时隐藏） */}
      {!isSearching && (
        <div className="px-3 flex flex-wrap gap-1.5">
          {tags.map((tag) => {
            const isActive = activePageType === tag.key;
            return (
              <div
                key={tag.key}
                onClick={() => {
                  setSearchText("");
                  setDebouncedKeyword("");
                  setActivePageType(tag.key);
                }}
                className={`h-6 px-2 text-xs rounded-xl cursor-pointer flex items-center gap-1 ${
                  isActive
                    ? "bg-blue-50 text-theme"
                    : "bg-[#F7F8FA] text-[#6B7280] hover:text-blue-500"
                }`}
              >
                <span>{tag.name}</span>
                <span>{tag.count}</span>
              </div>
            );
          })}
        </div>
      )}

      {/* 列表容器 (含A-Z) */}
      <div className="flex-1 overflow-hidden relative flex flex-col mt-3 min-h-0 bg-white">
        <div className="flex-1 px-3 space-y-1 overflow-y-auto">
          {loading && items.length === 0 ? (
            <div className="h-full flex items-center justify-center py-10">
              <Spin />
            </div>
          ) : items.length === 0 ? (
            <div className="text-center text-xs text-[#9CA3AF] py-6">
              {t("wiki.empty_knowledge")}
            </div>
          ) : (
            <>
              {items.map((item) => (
                <div
                  key={item.id}
                  id={`wiki-item-${item.slug}`}
                  onClick={() => {
                    setActiveTab("list");
                    setSelectedItemId(item.slug);
                    setSearchParams(
                      (prev) => {
                        prev.set("selected", item.slug);
                        prev.delete("sub");
                        prev.delete("vd-type");
                        return prev;
                      },
                      { replace: true },
                    );
                  }}
                  className={`px-3 py-2.5 cursor-pointer transition-colors rounded-lg ${selectedItemId === item.slug && activeTab === "list" ? "bg-[#F2F6FF]" : "hover:bg-gray-50"}`}
                >
                  <h3 className="text-sm truncate text-main">{item.title}</h3>
                  <p
                    className={`text-xs text-[#6B7280] line-clamp-2 my-1.5 ${
                      permissionMap[item.id] === PERMISSION_TYPE.none ? "blur-[2px]" : ""
                    }`}
                  >
                    {item.summary}
                  </p>
                  <div className="text-[11px] text-[#9CA3AF]">
                    {t("wiki.last_updated_label")} {getFormatTimeStamp(item.updated_time)}
                  </div>
                </div>
              ))}

              {/* 滚动加载哨兵 + 加载指示 */}
              <div ref={sentinelRef} className="h-px" />
              {hasMore && loading && (
                <div className="flex justify-center py-3">
                  <Spin size="small" />
                </div>
              )}
            </>
          )}
        </div>

        {/* 暂时隐藏字母排序及右侧纵向排序标签（SHOW_SORT_INDEX 仍保留以便日后恢复） */}
        {!isSearching && SHOW_SORT_INDEX && sortType === "alphabetical" && (
          <div className="absolute right-1 top-4 bottom-4 w-4 flex flex-col items-center text-[10px] text-gray-400 font-medium z-10">
            {"ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").map((char) => (
              <div
                key={char}
                className="hover:text-blue-500 cursor-pointer w-full text-center hover:bg-gray-100 rounded-sm leading-none"
                onClick={() => {
                  const target = items.find((item) =>
                    item.title.toUpperCase().startsWith(char),
                  );
                  if (target) {
                    const element = document.getElementById(
                      `wiki-item-${target.slug}`,
                    );
                    if (element) {
                      element.scrollIntoView({
                        behavior: "smooth",
                        block: "start",
                      });
                    }
                  }
                }}
              >
                {char}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default LeftSidebar;