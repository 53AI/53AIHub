import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import wikiApi from "@/api/modules/wiki";
import type {
  WikiPageItem,
  WikiPageListParams,
  WikiPageSortBy,
  WikiPageType,
  WikiSortOrder,
} from "@/api/modules/wiki";
import { useWikiStore } from "@/stores/modules/wiki";

export interface PageListQuery {
  pageType: WikiPageType;
  keyword: string;
  offset: number;
  limit: number;
  sortBy: WikiPageSortBy;
  sortOrder: WikiSortOrder;
}

/**
 * 构建 wiki 页面列表查询参数。
 *
 * 规则：有关键词（去空格非空）时走全局搜索——只带 keyword，忽略 page_type；
 * 否则按当前标签浏览——只带 page_type。分页与排序始终透传。
 */
export function buildPageListParams(query: PageListQuery): WikiPageListParams {
  const kw = query.keyword.trim();
  const params: WikiPageListParams = {
    offset: query.offset,
    limit: query.limit,
    sort_by: query.sortBy,
    sort_order: query.sortOrder,
  };
  if (kw) {
    params.keyword = kw;
  } else {
    params.page_type = query.pageType;
  }
  return params;
}

const DEFAULT_LIMIT = 30;

export interface UseWikiPageListArgs {
  spaceId: string;
  pageType: WikiPageType;
  keyword: string;
  sortBy: WikiPageSortBy;
  sortOrder: WikiSortOrder;
  limit?: number;
}

export interface UseWikiPageListResult {
  items: WikiPageItem[];
  total: number;
  loading: boolean;
  error: string | null;
  hasMore: boolean;
  loadMore: () => void;
  reload: () => void;
}

/**
 * 服务端驱动的 wiki 页面列表：按标签 / 关键词 / 排序查询，支持滚动分页追加。
 * 查询条件变化时自动重置到第一页。
 */
export function useWikiPageList(args: UseWikiPageListArgs): UseWikiPageListResult {
  const { spaceId, pageType, keyword, sortBy, sortOrder } = args;
  const limit = args.limit ?? DEFAULT_LIMIT;

  const [items, setItems] = useState<WikiPageItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 当前会话内被隐藏的页面 ID（如删除成功后被标记），渲染前先过滤掉。
  // 不触发任何接口请求——本地已知该页面应消失。
  const hiddenPageIds = useWikiStore((state) => state.hiddenPageIds);

  // 避免闭包读到过期值 / 处理竞态
  const itemsLenRef = useRef(0);
  itemsLenRef.current = items.length;
  const loadingRef = useRef(false);
  const reqIdRef = useRef(0);

  const hasMore = items.length < total;
  const hasMoreRef = useRef(false);
  hasMoreRef.current = hasMore;

  const fetchPage = useCallback(
    async (offset: number, mode: "replace" | "append") => {
      if (!spaceId) return;
      const reqId = ++reqIdRef.current;
      loadingRef.current = true;
      setLoading(true);
      setError(null);
      try {
        const params = buildPageListParams({
          pageType,
          keyword,
          offset,
          limit,
          sortBy,
          sortOrder,
        });
        const res = await wikiApi.pages(spaceId, params);
        if (reqId !== reqIdRef.current) return; // 已被更新的查询取代
        const next = res.items ?? [];
        setItems((prev) => (mode === "append" ? [...prev, ...next] : next));
        setTotal(res.total ?? 0);
      } catch (err) {
        if (reqId !== reqIdRef.current) return;
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (reqId === reqIdRef.current) {
          loadingRef.current = false;
          setLoading(false);
        }
      }
    },
    [spaceId, pageType, keyword, limit, sortBy, sortOrder],
  );

  // 查询条件变化：重置并加载第一页
  useEffect(() => {
    setItems([]);
    setTotal(0);
    if (!spaceId) return;
    fetchPage(0, "replace");
  }, [spaceId, fetchPage]);

  const loadMore = useCallback(() => {
    if (loadingRef.current || !hasMoreRef.current) return;
    fetchPage(itemsLenRef.current, "append");
  }, [fetchPage]);

  const reload = useCallback(() => {
    fetchPage(0, "replace");
  }, [fetchPage]);

  // 渲染前过滤掉当前会话内被隐藏的页面（如刚被删除的）。
  // 注意：hasMore / total 仍基于原始 items.length，因为服务端返回的 total
  // 不包含本地隐藏条目；过滤后的列表只是显示层面的"少了这一条"。
  const visibleItems = useMemo(
    () =>
      hiddenPageIds.size === 0
        ? items
        : items.filter((item) => !hiddenPageIds.has(item.id)),
    [items, hiddenPageIds],
  );

  return { items: visibleItems, total, loading, error, hasMore, loadMore, reload };
}
