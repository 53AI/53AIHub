import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { Spin, Empty, Checkbox, Tooltip } from "antd";
import { RightOutlined } from "@ant-design/icons";
import type { SpaceItem } from "@/api/modules/spaces";
import type { WikiPageItem, WikiPageType } from "@/api/modules/wiki";
import { wikiApi } from "@/api/modules/wiki";
import { spacesApi } from "@/api/modules/spaces";
import { permissionsApi } from "@/api/modules/permissions";
import { RESOURCE_TYPE, PERMISSION_TYPE } from "@/components/KMPermission/constant";
import { cacheManager as cache } from "@km/shared-utils";
import { getPublicPath } from "@/utils/config";
import { t } from "@/locales";
import { SvgIcon } from "@km/shared-components-react";
import { useUserStore } from "@/stores/modules/user";
import type { WikiItem } from "../dialog";

const PAGE_TYPE_I18N_KEY: Record<WikiPageType, string> = {
  concept: "wiki.page_type.concept",
  entity: "wiki.page_type.entity",
  index: "wiki.page_type.index",
  summary: "wiki.page_type.summary",
};

const KNOW_PAGE_TYPES: WikiPageType[] = ["concept", "entity", "index", "summary"];

export interface KnowledgeListProps {
  // 外部已选动态知识（空间和页面混合）
  selectedWikis: WikiItem[];
  // 开关
  allowSelectSpace?: boolean;
  // 回调
  onToggleSpace: (space: SpaceItem) => void;
  onTogglePage: (page: WikiPageItem) => void;
}

export function KnowledgeList({
  selectedWikis,
  allowSelectSpace = true,
  onToggleSpace,
  onTogglePage,
}: KnowledgeListProps) {
  const userEid = useUserStore((s) => s.info.eid);
  // 内部状态
  const [spaceList, setSpaceList] = useState<SpaceItem[]>([]);
  const [spaceId, setSpaceId] = useState("");
  const [spaceLoading, setSpaceLoading] = useState(false);
  const [activePageType, setActivePageType] = useState<WikiPageType>("concept");

  // 本地页面列表状态（不依赖全局 store）
  const [pageList, setPageList] = useState<WikiPageItem[]>([]);
  const [pageLoading, setPageLoading] = useState(false);
  const [pageOffset, setPageOffset] = useState(0);
  const [pageTotal, setPageTotal] = useState(0);
  const [pageLoadingMore, setPageLoadingMore] = useState(false);

  const [hasMore, setHasMore] = useState(true);
  const initializedRef = useRef(false);
  // 用 ref 镜像 pageLoadingMore / pageLoading,避免 loadMorePages / handleScroll 把它们纳入 deps
  // 导致每次加载都重建闭包、重新绑定 onScroll。
  const pageLoadingMoreRef = useRef(pageLoadingMore);
  pageLoadingMoreRef.current = pageLoadingMore;
  const pageLoadingRef = useRef(pageLoading);
  pageLoadingRef.current = pageLoading;

  // 分类统计（从 index 接口获取）
  const [pageTypeCounts, setPageTypeCounts] = useState<Record<WikiPageType, number>>({
    concept: 0,
    entity: 0,
    index: 0,
    summary: 0,
  });

  // 加载分类统计
  const loadPageTypeCounts = useCallback(async (spaceId: string) => {
    const data = await wikiApi.index(spaceId);
    setPageTypeCounts({
      concept: data.page_type_counts?.concept ?? 0,
      entity: data.page_type_counts?.entity ?? 0,
      index: data.page_type_counts?.index ?? 0,
      summary: data.page_type_counts?.summary ?? 0,
    });
  }, []);

  // 加载页面列表并做权限过滤
  const loadWikiPages = useCallback(async (spaceId: string, pageType: WikiPageType) => {
    setPageLoading(true);
    try {
      const data = await wikiApi.pages(spaceId, { offset: 0, limit: 100, page_type: pageType });
      const allPages = data.items ?? [];

      let permissionMap: Record<string, number> = {};
      if (allPages.length > 0) {
        permissionMap = await permissionsApi.myBatch({
          resource_type: RESOURCE_TYPE.wiki_page,
          resource_ids: allPages.map((item: WikiPageItem) => item.id),
        });
      }

      const filteredPages = allPages.filter((item: WikiPageItem) => {
        if (item.visibility !== 'private') return true;
        const key = `${RESOURCE_TYPE.wiki_page}:${item.id}`;
        return permissionMap[key] >= PERMISSION_TYPE.viewer;
      });

      setPageList(filteredPages);
      setPageOffset(filteredPages.length);
      setPageTotal(data.total ?? 0);
      setHasMore(filteredPages.length < (data.total ?? 0));
    } finally {
      setPageLoading(false);
    }
  }, []);

  // 加载更多页面(已在内部 setHasMore,外部不需要重复设置)
  // 通过 ref 读取 pageLoadingMore,避免把它放入 deps 引起回调重建
  const loadMorePages = useCallback(async (spaceId: string, currentOffset: number, currentTotal: number, pageType: WikiPageType) => {
    if (pageLoadingMoreRef.current) return false;
    if (currentOffset >= currentTotal) return false;

    setPageLoadingMore(true);
    try {
      const data = await wikiApi.pages(spaceId, { offset: currentOffset, limit: 100, page_type: pageType });
      const newItems = data.items ?? [];

      // 权限过滤
      let permissionMap: Record<string, number> = {};
      if (newItems.length > 0) {
        permissionMap = await permissionsApi.myBatch({
          resource_type: RESOURCE_TYPE.wiki_page,
          resource_ids: newItems.map((item: WikiPageItem) => item.id),
        });
      }

      const filteredNewItems = newItems.filter((item: WikiPageItem) => {
        if (item.visibility !== 'private') return true;
        const key = `${RESOURCE_TYPE.wiki_page}:${item.id}`;
        return permissionMap[key] >= PERMISSION_TYPE.viewer;
      });

      setPageList((prev) => [...prev, ...filteredNewItems]);
      const newOffset = currentOffset + filteredNewItems.length;
      setPageOffset(newOffset);
      const hasMorePages = newOffset < (data.total ?? 0);
      setHasMore(hasMorePages);
      return hasMorePages;
    } finally {
      setPageLoadingMore(false);
    }
  }, []);

  // 加载动态知识空间列表（全部空间 + 过滤开启动态知识的 + 权限过滤）
  // 缓存键按用户 eid 命名,避免跨账号/agent 命中错数据。
  // 注意:此处的 space list 与 SpaceDialog 的 spaces_list 不合并,因为 limit 不同
  // (本组件需要全量 1000 条用于客户端过滤),所以另开 key。
  const loadWikiSpaceList = useCallback(async () => {
    // 如果已经加载过空间列表，直接跳过
    if (initializedRef.current && spaceList.length > 0) {
      return;
    }

    setSpaceLoading(true);
    try {
      const scopeKey = userEid || "anonymous";
      // 获取完整的空间列表缓存
      const list: any = await cache.getOrFetch(`wiki_spaces_list_all:${scopeKey}`, () => {
        return spacesApi.list({
          status: 0,
          limit: 1000,
          offset: 0,
          view: "user",
        });
      });

      // 获取已过滤+权限检查后的空间列表
      const filteredSpaces: SpaceItem[] = await cache.getOrFetch(
        `wiki_spaces_list_filtered:${scopeKey}`,
        async () => {
          // 过滤开启动态知识的空间
          const enabledSpaces = list.spaces.filter(
            (item: SpaceItem) => item.enable_wiki_dynamic_knowledge === true
          );

          if (enabledSpaces.length === 0) {
            return [];
          }

          // 权限过滤
          const privateSpaces = enabledSpaces.filter((item: SpaceItem) => !item.visibility);
          let permissionMap: Record<string, number> = {};
          if (privateSpaces.length > 0) {
            permissionMap = await permissionsApi.myBatch({
              resource_type: RESOURCE_TYPE.space,
              resource_ids: privateSpaces.map((item: SpaceItem) => item.id),
            });
          }

          return enabledSpaces.filter((item: SpaceItem) => {
            if (item.visibility) return true;
            const key = `${RESOURCE_TYPE.space}:${item.id}`;
            return permissionMap[key] >= PERMISSION_TYPE.viewer;
          })
        }
      );

      setSpaceList(filteredSpaces);

      // 首次加载时默认选中第一个空间
      if (!initializedRef.current && filteredSpaces.length > 0) {
        initializedRef.current = true;
        setSpaceId(filteredSpaces[0].id);
        loadWikiPages(filteredSpaces[0].id, activePageType);
        loadPageTypeCounts(filteredSpaces[0].id);
      }
    } finally {
      setSpaceLoading(false);
    }
  }, [loadWikiPages, userEid]);

  // 首次加载空间列表
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        await loadWikiSpaceList();
      } catch {
        // 静默吞掉,UI 由内部 finally 复原 loading
      }
      if (cancelled) {
        // 卸载后无副作用,因为 loadWikiSpaceList 内部已 setSpaceLoading(false)
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [loadWikiSpaceList]);

  // 切换空间时加载页面和统计
  useEffect(() => {
    if (!spaceId) return;
    let cancelled = false;
    const run = async () => {
      try {
        await loadWikiPages(spaceId, activePageType);
        if (cancelled) return;
        await loadPageTypeCounts(spaceId);
      } catch {
        // 静默吞掉
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [spaceId, loadWikiPages, loadPageTypeCounts, activePageType]);

  // 标签列表（去掉"全部"）
  const tags = useMemo(() => {
    return KNOW_PAGE_TYPES.map((k) => ({
      name: t(PAGE_TYPE_I18N_KEY[k]),
      count: pageTypeCounts[k] ?? 0,
      key: k,
    }));
  }, [pageTypeCounts]);

  // 过滤列表（API 已按分类过滤，只需排序）
  const filteredList = useMemo(() => {
    return [...pageList].sort((a, b) =>
      a.title.localeCompare(b.title, "zh-Hans-CN", { sensitivity: "base" }),
    );
  }, [pageList]);

  // 判断单个是否选中
  const isPageSelected = useCallback(
    (page: WikiPageItem) => selectedWikis.some((w) => w.wikiType === 'page' && w.id === page.id),
    [selectedWikis],
  );

  // 处理页面点击
  const handlePageClick = useCallback(
    (page: WikiPageItem) => {
      onTogglePage(page);
    },
    [onTogglePage],
  );

  // 滚动加载更多(loading 状态通过 ref 读取最新值,不进 deps)
  const handleScroll = useCallback(
    (e: React.UIEvent<HTMLDivElement>) => {
      const target = e.target as HTMLDivElement;
      const { scrollTop, scrollHeight, clientHeight } = target;
      if (scrollHeight - scrollTop - clientHeight < 50 && hasMore && !pageLoadingMoreRef.current && !pageLoadingRef.current) {
        loadMorePages(spaceId, pageOffset, pageTotal, activePageType);
      }
    },
    [hasMore, spaceId, loadMorePages, pageOffset, pageTotal, activePageType],
  );

  // 处理空间选择(组件内部维护 active space,无需回调到外部)
  const handleSpaceSelect = useCallback((id: string) => {
    setSpaceId(id);
  }, []);

  return (
    <div className="h-[500px] flex overflow-hidden border rounded-xl">
      {/* 第一列：空间列表 */}
      <div className="flex-none w-[216px] py-1 border-r flex flex-col overflow-hidden">
        <div className="h-9 px-4 flex items-center text-sm text-secondary">
          {t("space.label")}
        </div>
        <div className="flex-1 px-2 space-y-1 overflow-y-auto">
          {spaceLoading ? (
            <div className="flex justify-center py-4">
              <Spin />
            </div>
          ) : spaceList.length === 0 ? (
            <Empty
              image={getPublicPath("/images/empty.png")}
              description={t("common.no_data")}
              className="py-8"
            />
          ) : (
            spaceList.map((item) => (
              <div
                key={item.id}
                className={`h-9 flex items-center gap-2 px-2 mb-1 rounded cursor-pointer text-[#1D1E1F] ${
                  spaceId === item.id
                    ? "bg-[#EDF3FF] hover:bg-[#EDF3FF]"
                    : "hover:bg-[#F2F3F5]"
                }`}
                onClick={() => handleSpaceSelect(item.id)}
              >
                {allowSelectSpace && (
                  <Checkbox
                    checked={selectedWikis.some((w) => w.wikiType === 'space' && w.id === item.id)}
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleSpace(item);
                    }}
                  />
                )}
                <div className="size-5 rounded flex items-center justify-center bg-[#E6EEFF] text-[#4798F5]">
                  <SvgIcon name="database-k" size={14} />
                </div>
                <Tooltip title={item.name}>
                  <span className="flex-1 text-sm truncate">{item.name}</span>
                </Tooltip>
                {spaceId === item.id && (
                  <RightOutlined className="text-xs text-[#999]" />
                )}
              </div>
            ))
          )}
        </div>
      </div>

      {/* 第二列：分类 */}
      <div className="flex-none w-[216px] py-1 border-r flex flex-col overflow-hidden">
        <div className="h-9 px-4 flex items-center text-sm text-secondary">
          {t("dynamic_knowledge.category_label")}
        </div>
        <div className="flex-1 px-2 space-y-1 overflow-y-auto">
          {/* 各分类（去掉"全部"） */}
          {tags.map((tag) => (
            <div
              key={tag.key}
              onClick={() => setActivePageType(tag.key)}
              className={`h-9 flex items-center gap-2 px-2 mb-1 rounded cursor-pointer text-[#1D1E1F] ${
                activePageType === tag.key
                  ? "bg-[#EDF3FF] hover:bg-[#EDF3FF]"
                  : "hover:bg-[#F2F3F5]"
              }`}
            >
              <div className="size-5 rounded flex items-center justify-center bg-[#E6EEFF] text-[#4798F5]">
                <SvgIcon name="document-folder" size={14} />
              </div>
              <span className="flex-1 text-sm">{tag.name}</span>
              {activePageType === tag.key && <RightOutlined className="text-xs text-[#999]" />}
            </div>
          ))}
        </div>
      </div>

      {/* 第三列：动态知识列表 */}
      <div className="flex-1 overflow-y-auto" onScroll={handleScroll}>
        <div className="h-9 px-4 flex items-center text-sm text-secondary">
          {t("dynamic_knowledge.label")}
        </div>
        {!spaceId ? (
          <Empty
            image={getPublicPath("/images/empty.png")}
            description={t("dynamic_knowledge.select_space_first")}
            className="py-20"
          />
        ) : pageLoading ? (
          <div className="flex justify-center py-8">
            <Spin />
          </div>
        ) : filteredList.length === 0 ? (
          <Empty
            image={getPublicPath("/images/empty.png")}
            description={t("dynamic_knowledge.empty_data")}
            className="py-20"
          />
        ) : (
          <div className="px-2 py-1 space-y-1">
            {filteredList.map((item) => {
              const isSelected = isPageSelected(item);
              return (
                <div
                  key={item.id}
                  onClick={() => handlePageClick(item)}
                  className={`h-9 flex items-center gap-2 px-2 rounded cursor-pointer ${
                    isSelected ? "hover:bg-[#EDF3FF]" : "hover:bg-[#F2F3F5]"
                  }`}
                >
                  <Checkbox checked={isSelected} />
                  <div className="size-5 rounded flex items-center justify-center bg-[#4798F5] text-white">
                    <SvgIcon name="doc-detail" size={14} />
                  </div>
                  <Tooltip title={item.title}>
                    <span className="flex-1 text-sm text-[#1D1E1F] truncate">{item.title}</span>
                  </Tooltip>
                </div>
              );
            })}
            {pageLoadingMore && (
              <div className="flex justify-center py-4">
                <Spin size="small" />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
