import { useState, useEffect, useCallback, useRef } from "react";
import { globalSearchApi } from "@/api/modules/global-search";
import { debounce } from "@km/shared-utils";
import type { DynamicSearchParams, WikiSearchResultItem } from "@/api/modules/global-search/types";
import type { FilterParams } from "../types";
import { hasFilterConditions } from "../utils/filter";

const PAGE_SIZE = 20;

/** 最近模式：最近访问 / 最近更新（与「知识文档」Tab 一致） */
export type RecentMode = "recent_access" | "recent_update";

/** 最近模式首页缓存：两种模式各自缓存首页数据，切换时直接命中 */
interface ModeCache {
  items: WikiSearchResultItem[];
  total: number;
  loaded: boolean;
}

export interface UseDynamicSearchReturn {
  results: WikiSearchResultItem[];
  total: number;
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  loadMore: () => void;
  /** 当前最近模式（仅无关键词、无筛选时生效） */
  mode: RecentMode;
  setMode: (mode: RecentMode) => void;
  /** 是否处于搜索/筛选模式（关键词非空或任一筛选条件生效） */
  isSearchMode: boolean;
}

/**
 * 动态知识（wiki）搜索 hook
 *
 * 向 /api/global-search/search 发送 `{ sources: ["wiki"], ...筛选参数, page, size }`，
 * 结果项为 wiki 页结构（WikiSearchResultItem）。
 *
 * - 关键词非空：防抖触发搜索
 * - 关键词为空且无筛选：请求最近 wiki 页面，按 mode（recent_access / recent_update）
 *   排序返回，与「知识文档」Tab 的「最近访问 / 最近更新」子标签一致；
 *   两种模式各自缓存首页数据，来回切换时直接命中缓存
 * - 筛选（知识空间 / 创建时间 / 更新时间）变化即重新请求，与「知识文档」Tab 一致
 *
 * 两种模式均支持无限滚动分页。
 */
export function useDynamicSearch(
  searchQuery: string,
  filterParams: FilterParams,
): UseDynamicSearchReturn {
  const [results, setResults] = useState<WikiSearchResultItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [page, setPage] = useState(1);

  // 最近访问 / 最近更新模式
  const [mode, setMode] = useState<RecentMode>("recent_access");

  // 版本号：关键词/筛选/模式变化即自增，用于丢弃过期请求的响应（竞态防护）
  const versionRef = useRef(0);
  const queryRef = useRef("");
  const filterRef = useRef<FilterParams>(filterParams);

  // 两种最近模式的首页缓存
  const cacheRef = useRef<Record<RecentMode, ModeCache>>({
    recent_access: { items: [], total: 0, loaded: false },
    recent_update: { items: [], total: 0, loaded: false },
  });

  const query = searchQuery.trim();

  // 是否处于搜索/筛选模式
  const isSearchMode = query.length > 0 || hasFilterConditions(filterParams);

  const resetListState = useCallback(() => {
    setResults([]);
    setTotal(0);
    setPage(1);
    setHasMore(false);
    setLoadingMore(false);
  }, []);

  const runSearch = useCallback(async (kw: string, params: FilterParams, pageNum: number, append: boolean, sortBy?: RecentMode) => {
    const version = versionRef.current;
    queryRef.current = kw;
    filterRef.current = params;
    if (append) {
      setLoadingMore(true);
    } else {
      // 新搜索会废弃在途的加载更多：复位其 loading 标记，避免 loadingMore 卡死、分页失效
      setLoadingMore(false);
      setLoading(true);
    }
    try {
      const searchParams: DynamicSearchParams = {
        sources: ["wiki"],
        page: pageNum,
        size: PAGE_SIZE,
      };

      // 关键词非空时传 query；为空且无筛选时按当前最近模式（访问/更新）排序返回
      if (kw) {
        searchParams.query = kw;
      } else if (!hasFilterConditions(params)) {
        searchParams.sort_by = sortBy ?? "recent_access";
      }

      // 筛选参数（与「知识文档」一致）
      if (params.spaceIds.length > 0) searchParams.space_ids = params.spaceIds;
      if (params.libraryIds.length > 0) searchParams.library_ids = params.libraryIds;
      if (params.creatorIds.length > 0) searchParams.creator_ids = params.creatorIds;
      if (params.fileTypes.length > 0) searchParams.file_types = params.fileTypes;
      if (params.createdTimeFrom !== undefined) searchParams.created_time_from = params.createdTimeFrom;
      if (params.updatedTimeFrom !== undefined) searchParams.updated_time_from = params.updatedTimeFrom;

      const res = await globalSearchApi.dynamicSearch(searchParams);
      // 关键词/筛选/模式已变化，丢弃过期响应
      if (version !== versionRef.current) return;
      const items = res.wiki_results?.items || [];
      const totalCount = res.wiki_results?.total || 0;
      if (append) {
        setResults((prev) => {
          const merged = [...prev, ...items];
          setHasMore(merged.length < totalCount);
          return merged;
        });
      } else {
        setResults(items);
        setHasMore(items.length < totalCount);
        // 最近模式首页成功后写入缓存，供模式切换时直接命中
        if (!kw && !hasFilterConditions(params) && sortBy) {
          cacheRef.current[sortBy] = { items, total: totalCount, loaded: true };
        }
      }
      setTotal(totalCount);
      setPage(pageNum);
    } catch (error: any) {
      if (version !== versionRef.current) return;
      if (error?.name !== "AbortError" && error?.code !== "ERR_CANCELED") {
        console.error("动态知识搜索失败:", error);
        if (!append) setResults([]);
      }
    } finally {
      // 仅当请求未过期时复位 loading 标记（在途的加载更多已在新的首搜开始时复位）
      if (version === versionRef.current) {
        if (append) setLoadingMore(false)
        else setLoading(false)
      }
    }
  }, []);

  // 防抖搜索（有关键词时触发）
  const debouncedSearch = useRef(
    debounce((kw: string, params: FilterParams) => {
      versionRef.current += 1;
      runSearch(kw, params, 1, false);
    }, 300),
  ).current;

  // 语义比较：Filter 组件挂载时会用等值但不同引用的状态触发 onChange，
  // 仅引用变化（内容相同）时不应重新请求；首次挂载总是执行初始加载
  const prevFilterJson = useRef(JSON.stringify(filterParams));
  const prevQuery = useRef(query);
  const prevMode = useRef(mode);
  const hasRunRef = useRef(false);

  // 监听关键词 / 筛选 / 最近模式变化：空关键词立即请求，有关键词防抖；首帧即初始加载
  useEffect(() => {
    const filterJson = JSON.stringify(filterParams);
    const filterChanged = filterJson !== prevFilterJson.current;
    const queryChanged = query !== prevQuery.current;
    const modeChanged = mode !== prevMode.current;
    prevFilterJson.current = filterJson;
    prevQuery.current = query;
    prevMode.current = mode;

    // 模式仅在最近模式（无关键词、无筛选）下影响请求；搜索/筛选模式下忽略
    const modeAffectsRequest = modeChanged && !query && !hasFilterConditions(filterParams);

    // 首次挂载：总是执行初始加载；后续仅内容变化时重新请求
    if (hasRunRef.current && !filterChanged && !queryChanged && !modeAffectsRequest) return;
    hasRunRef.current = true;

    versionRef.current += 1;
    debouncedSearch.cancel();
    if (!query) {
      // 清空关键词 / 无关键词筛选：取消未触发的防抖计时器并复位加载态，随后立即请求
      resetListState();
      // 最近模式：优先命中当前模式的首页缓存
      if (!hasFilterConditions(filterParams)) {
        const cache = cacheRef.current[mode];
        if (cache.loaded) {
          setResults(cache.items);
          setTotal(cache.total);
          setHasMore(cache.items.length >= PAGE_SIZE);
          setLoading(false);
          return;
        }
      }
      runSearch("", filterParams, 1, false, mode);
      return;
    }
    debouncedSearch(query, filterParams);
  }, [query, filterParams, mode]);

  const loadMore = useCallback(() => {
    if (loadingMore || !hasMore) return;
    runSearch(queryRef.current, filterRef.current, page + 1, true, mode);
  }, [loadingMore, hasMore, page, runSearch, mode]);

  return { results, total, loading, loadingMore, hasMore, loadMore, mode, setMode, isSearchMode };
}
