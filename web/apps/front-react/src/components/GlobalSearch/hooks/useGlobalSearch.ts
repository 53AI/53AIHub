import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { globalSearchApi } from "@/api/modules/global-search";
import { getSimpleDateFormatString, debounce } from "@km/shared-utils";
import { formatFileInfo } from "@/api/modules/files/transform";
import type {
  GlobalSearchSpace,
  GlobalSearchLibrary,
  GlobalSearchResultItem,
  GlobalSearchResponse,
} from "@/api/modules/global-search/types";
import type { FilterParams } from "../types";
import { hasFilterConditions } from "../utils/filter";

// ==================== 类型定义 ====================

export interface GlobalSearchFile {
  file_id: string;
  name: string;
  icon: string;
  path: string;
  library_id: string;
  library_name: string;
  space_id: string;
  space_name: string;
  creator_id: number;
  creator_name: string;
  location: string;
  lastUpdated: string;
  isfolder: boolean;
}

export interface UseGlobalSearchReturn {
  // 显示数据（根据模式自动切换最近/搜索结果）
  spaces: GlobalSearchSpace[];
  libraries: GlobalSearchLibrary[];
  files: GlobalSearchFile[];
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  loadMore: () => void;
  // 当前模式
  mode: "recent_access" | "recent_update";
  setMode: (mode: "recent_access" | "recent_update") => void;
  // 是否处于搜索模式
  isSearchMode: boolean;
  searchTotal: number;
  searchLoading: boolean;
  // 生命周期
  refresh: () => void;
  reset: () => void;
}

// ==================== 缓存类型 ====================

interface CacheData {
  spaces: GlobalSearchSpace[];
  libraries: GlobalSearchLibrary[];
  files: GlobalSearchFile[];
  loaded: boolean;
}

const PAGE_SIZE = 20;

export function useGlobalSearch(
  searchQuery: string,
  filterParams: FilterParams,
): UseGlobalSearchReturn {
  // 当前模式
  const [mode, setMode] = useState<"recent_access" | "recent_update">("recent_access");

  // 是否已初始化
  const [initialized, setInitialized] = useState(false);

  // 缓存两种模式的数据
  const cacheRef = useRef<Record<"recent_access" | "recent_update", CacheData>>({
    recent_access: { spaces: [], libraries: [], files: [], loaded: false },
    recent_update: { spaces: [], libraries: [], files: [], loaded: false },
  });

  // QuickTags 数据
  const [quickTagsSpaces, setQuickTagsSpaces] = useState<GlobalSearchSpace[]>([]);
  const [quickTagsLibraries, setQuickTagsLibraries] = useState<GlobalSearchLibrary[]>([]);

  // 最近访问/更新数据
  const [recentFiles, setRecentFiles] = useState<GlobalSearchFile[]>([]);
  const [recentPage, setRecentPage] = useState(1);
  const [recentHasMore, setRecentHasMore] = useState(false);
  const [recentLoading, setRecentLoading] = useState(false);
  const [recentLoadingMore, setRecentLoadingMore] = useState(false);

  // 搜索结果
  const [searchFiles, setSearchFiles] = useState<GlobalSearchFile[]>([]);
  const [searchTotal, setSearchTotal] = useState(0);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchLoadingMore, setSearchLoadingMore] = useState(false);
  const [searchPage, setSearchPage] = useState(1);
  const [searchHasMore, setSearchHasMore] = useState(false);
  // 搜索模式下的空间/知识库（由专用接口查询得到）
  const [searchSpacesList, setSearchSpacesList] = useState<GlobalSearchSpace[]>([]);
  const [searchLibrariesList, setSearchLibrariesList] = useState<GlobalSearchLibrary[]>([]);
  // 缓存当前搜索参数，用于加载更多
  const currentSearchParams = useRef<{ query: string; params: FilterParams }>({ query: "", params: { spaceIds: [], libraryIds: [], creatorIds: [], fileTypes: [] } });

  // AbortController
  const searchAbortRef = useRef<AbortController | null>(null);
  const spacesAbortRef = useRef<AbortController | null>(null);
  const librariesAbortRef = useRef<AbortController | null>(null);

  // 判断是否有搜索或筛选条件
  const isSearchMode = useMemo(() => {
    return searchQuery.trim().length > 0 || hasFilterConditions(filterParams);
  }, [searchQuery, filterParams]);

  // 转换搜索结果
  const transformResult = useCallback(
    (item: GlobalSearchResultItem): GlobalSearchFile => {
      const isfolder = item.isfolder ?? item.type === 0;
      const { fname, icon } = formatFileInfo(item.file_name, isfolder);

      return {
        file_id: item.file_id,
        name: fname,
        icon: icon,
        path: item.path,
        library_id: item.library_id,
        library_name: item.library_name,
        space_id: item.space_id,
        space_name: item.space_name,
        creator_id: item.creator_id,
        creator_name: item.creator_name,
        location: `${item.space_name}/${item.library_name}`,
        lastUpdated: getSimpleDateFormatString({ date: item.latest_file_body_update_time }),
        isfolder: isfolder,
      };
    },
    [],
  );

  // ==================== 最近访问/更新数据 ====================

  const loadRecentData = useCallback(async (targetMode: "recent_access" | "recent_update", pageNum: number = 1, append: boolean = false) => {
    // 检查缓存
    if (!append) {
      const cache = cacheRef.current[targetMode];
      if (cache.loaded) {
        setQuickTagsSpaces(cache.spaces);
        setQuickTagsLibraries(cache.libraries);
        setRecentFiles(cache.files);
        setRecentPage(1);
        setRecentHasMore(cache.files.length >= PAGE_SIZE);
        return;
      }
    }

    const setLoading = append ? setRecentLoadingMore : setRecentLoading;
    setLoading(true);

    try {
      if (append) {
        // 加载更多：只请求文件列表
        const searchRes = await globalSearchApi.search({
          sort_by: targetMode,
          page: pageNum,
          size: PAGE_SIZE,
        });

        const newFiles = (searchRes.results || []).map(transformResult);
        setRecentFiles((prev) => [...prev, ...newFiles]);
        setRecentPage(pageNum);
        setRecentHasMore(newFiles.length >= PAGE_SIZE);
      } else {
        // 首次加载：并行请求
        const [quickTagsRes, searchRes] = await Promise.all([
          globalSearchApi.quickTags({ mode: targetMode }),
          globalSearchApi.search({
            sort_by: targetMode,
            page: pageNum,
            size: PAGE_SIZE,
          }),
        ]);

        const newSpaces = quickTagsRes.spaces || [];
        const newLibraries = quickTagsRes.libraries || [];
        const newFiles = (searchRes.results || []).map(transformResult);

        // 更新缓存
        cacheRef.current[targetMode] = {
          spaces: newSpaces,
          libraries: newLibraries,
          files: newFiles,
          loaded: true,
        };

        setQuickTagsSpaces(newSpaces);
        setQuickTagsLibraries(newLibraries);
        setRecentFiles(newFiles);
        setRecentPage(pageNum);
        setRecentHasMore(newFiles.length >= PAGE_SIZE);
      }
    } catch (error: any) {
      console.error("加载最近数据失败:", error);
    } finally {
      setLoading(false);
    }
  }, [transformResult]);

  const loadMoreRecent = useCallback(() => {
    if (recentLoadingMore || !recentHasMore) return;
    const nextPage = recentPage + 1;
    loadRecentData(mode, nextPage, true);
  }, [mode, recentPage, recentLoadingMore, recentHasMore, loadRecentData]);

  // ==================== 搜索逻辑 ====================

  const executeSearch = useCallback(async (query: string, params: FilterParams, pageNum: number = 1, append: boolean = false) => {
    // 取消之前的请求（仅首次搜索时取消，加载更多不取消）
    if (!append && searchAbortRef.current) {
      searchAbortRef.current.abort();
    }
    searchAbortRef.current = new AbortController();

    const trimmedKeyword = query.trim();
    const hasKeyword = trimmedKeyword.length > 0;

    // 首次搜索且有关键词：取消并重建 spaces/libraries 的 AbortController
    if (!append && hasKeyword) {
      spacesAbortRef.current?.abort();
      librariesAbortRef.current?.abort();
      spacesAbortRef.current = new AbortController();
      librariesAbortRef.current = new AbortController();
    }

    const setLoading = append ? setSearchLoadingMore : setSearchLoading;
    setLoading(true);

    try {
      const searchParams: any = {
        page: pageNum,
        size: PAGE_SIZE,
      };

      // 关键词
      if (hasKeyword) {
        searchParams.query = trimmedKeyword;
      }

      // 筛选参数
      if (params.spaceIds.length > 0) {
        searchParams.space_ids = params.spaceIds;
      }
      if (params.libraryIds.length > 0) {
        searchParams.library_ids = params.libraryIds;
      }
      if (params.creatorIds.length > 0) {
        searchParams.creator_ids = params.creatorIds;
      }
      if (params.fileTypes.length > 0) {
        searchParams.file_types = params.fileTypes;
      }
      if (params.createdTimeFrom !== undefined) {
        searchParams.created_time_from = params.createdTimeFrom;
      }
      if (params.updatedTimeFrom !== undefined) {
        searchParams.updated_time_from = params.updatedTimeFrom;
      }

      // 空间/知识库的额外筛选条件（仅在有关键词时才会真正发出请求）
      const scopeFilterParams: { keyword?: string; creator_ids?: number[]; created_time_from?: number; updated_time_from?: number } = {};
      if (params.creatorIds.length > 0) scopeFilterParams.creator_ids = params.creatorIds;
      if (params.createdTimeFrom !== undefined) scopeFilterParams.created_time_from = params.createdTimeFrom;
      if (params.updatedTimeFrom !== undefined) scopeFilterParams.updated_time_from = params.updatedTimeFrom;
      if (hasKeyword) scopeFilterParams.keyword = trimmedKeyword

      // 并行调用文档搜索和（有关键词时）空间/知识库搜索
      const tasks: [Promise<GlobalSearchResponse>, Promise<GlobalSearchSpace[] | null>, Promise<GlobalSearchLibrary[] | null>] = [
        globalSearchApi.search(searchParams),
        Object.keys(scopeFilterParams).length && !searchParams.space_ids && !searchParams.library_ids ? globalSearchApi.spaces({ ...scopeFilterParams }) : Promise.resolve(null),
        (Object.keys(scopeFilterParams).length && !searchParams.library_ids || searchParams.space_ids) ? globalSearchApi.libraries({ ...scopeFilterParams, space_ids: searchParams.space_ids }) : Promise.resolve(null)
      ];
      const [searchRes, spacesRes, librariesRes] = await Promise.all(tasks);

      const newFiles = (searchRes.results || []).map(transformResult);
      const total = searchRes.total || 0;

      if (append) {
        setSearchFiles((prev) => {
          const updated = [...prev, ...newFiles];
          setSearchHasMore(updated.length < total);
          return updated;
        });
      } else {
        setSearchFiles(newFiles);
        setSearchHasMore(newFiles.length < total);
      }
      setSearchTotal(total);
      setSearchPage(pageNum);

      // 缓存搜索参数，用于加载更多
      if (!append) {
        currentSearchParams.current = { query, params };
        setSearchSpacesList(spacesRes || []);
        setSearchLibrariesList(librariesRes || []);
      }
    } catch (error: any) {
      if (error.name !== "AbortError" && error.code !== "ERR_CANCELED") {
        console.error("搜索失败:", error);
        if (!append) {
          setSearchFiles([]);
          setSearchSpacesList([]);
          setSearchLibrariesList([]);
        }
      }
    } finally {
      setLoading(false);
    }
  }, [transformResult]);

  const loadMoreSearch = useCallback(() => {
    if (searchLoadingMore || !searchHasMore) return;
    const { query, params } = currentSearchParams.current;
    executeSearch(query, params, searchPage + 1, true);
  }, [searchLoadingMore, searchHasMore, searchPage, executeSearch]);

  // 防抖搜索
  const debouncedSearch = useRef(
    debounce((query: string, params: FilterParams) => {
      executeSearch(query, params);
    }, 300),
  ).current;

  // ==================== 监听搜索/筛选条件变化 ====================

  useEffect(() => {
    if (!initialized) return;

    if (isSearchMode) {
      debouncedSearch(searchQuery, filterParams);
    } else {
      setSearchFiles([]);
      setSearchTotal(0);
    }
  }, [initialized, isSearchMode, searchQuery, filterParams]);

  // ==================== 初始化加载 ====================

  useEffect(() => {
    if (initialized && !isSearchMode) {
      loadRecentData(mode);
    }
  }, [initialized, mode, isSearchMode]);

  // 切换模式
  const handleSetMode = useCallback(
    (newMode: "recent_access" | "recent_update") => {
      setMode(newMode);
      if (!isSearchMode) {
        loadRecentData(newMode);
      }
    },
    [isSearchMode, loadRecentData],
  );

  // ==================== 搜索结果中的空间/知识库 ====================

  const searchSpaces = useMemo(() => {
    if (!isSearchMode) return [];
    return searchSpacesList;
  }, [isSearchMode, searchQuery, searchSpacesList, searchFiles, quickTagsSpaces]);

  const searchLibraries = useMemo(() => {
    if (!isSearchMode) return [];

    return searchLibrariesList;

  }, [isSearchMode, searchQuery, searchLibrariesList, searchFiles, quickTagsLibraries]);

  // ==================== 统一输出 ====================

  const displaySpaces = isSearchMode ? searchSpaces : quickTagsSpaces;
  const displayLibraries = isSearchMode ? searchLibraries : quickTagsLibraries;
  const displayFiles = isSearchMode ? searchFiles : recentFiles;
  const displayLoading = isSearchMode ? searchLoading : recentLoading;
  const displayLoadingMore = isSearchMode ? searchLoadingMore : recentLoadingMore;
  const displayHasMore = isSearchMode ? searchHasMore : recentHasMore;
  const displayLoadMore = isSearchMode ? loadMoreSearch : loadMoreRecent;

  // 刷新
  const refresh = useCallback(() => {
    setInitialized(true);
  }, []);

  // 重置
  const reset = useCallback(() => {
    searchAbortRef.current?.abort();
    spacesAbortRef.current?.abort();
    librariesAbortRef.current?.abort();
    searchAbortRef.current = null;
    spacesAbortRef.current = null;
    librariesAbortRef.current = null;
    setInitialized(false);
    setRecentFiles([]);
    setRecentPage(1);
    setRecentHasMore(false);
    setSearchFiles([]);
    setSearchTotal(0);
    setSearchPage(1);
    setSearchHasMore(false);
    setSearchSpacesList([]);
    setSearchLibrariesList([]);
    currentSearchParams.current = { query: "", params: { spaceIds: [], libraryIds: [], creatorIds: [], fileTypes: [] } };
    cacheRef.current = {
      recent_access: { spaces: [], libraries: [], files: [], loaded: false },
      recent_update: { spaces: [], libraries: [], files: [], loaded: false },
    };
  }, []);

  return {
    spaces: displaySpaces,
    libraries: displayLibraries,
    files: displayFiles,
    loading: displayLoading,
    loadingMore: displayLoadingMore,
    hasMore: displayHasMore,
    loadMore: displayLoadMore,
    mode,
    setMode: handleSetMode,
    isSearchMode,
    searchTotal,
    searchLoading,
    refresh,
    reset,
  };
}
