import { create } from "zustand";
import wikiApi from "@/api/modules/wiki";
import type { WikiPageDetail, WikiPageItem } from "@/api/modules/wiki";

interface WikiState {
  // ---- pages list ----
  pagesSpaceId: string;
  pagesData: WikiPageItem[];
  pagesLoading: boolean;
  pagesLoadingMore: boolean;
  pagesOffset: number;
  pagesTotal: number;
  pagesError: string | null;
  /**
   * 在当前会话内被隐藏的页面 ID 集合。
   * 用于删除等"远端已变更但本地列表不会重新拉取"的场景下，
   * 让 useWikiPageList 在渲染前直接过滤掉已删除的条目，
   * 避免再次请求接口。
   */
  hiddenPageIds: Set<string>;

  // ---- page detail (按 slug 缓存) ----
  pageDetails: Record<string, WikiPageDetail>;
  pageDetailLoading: Record<string, boolean>;
  pageDetailInflight: Set<string>; // 正在请求中的 slug，防止 StrictMode 双重触发

  // ---- restore from history ----
  restoreContent: string | null;
  isRestore: boolean;

  /** 加载指定空间的页面列表；force=true 时绕过缓存强制刷新 */
  loadPages: (space_id: string, force?: boolean) => Promise<void>;
  /** 加载更多页面 */
  loadMorePages: (space_id: string) => Promise<boolean>;
  /** 加载指定空间的页面详情（slug 维度缓存）；force=true 强制刷新 */
  loadPage: (space_id: string, slug: string, force?: boolean) => Promise<WikiPageDetail | null>;
  /** 切换空间时清空所有缓存 */
  resetAll: () => void;
  /** 清除恢复状态 */
  clearRestore: () => void;
  /** 把指定 ID 标记为"在本地列表中隐藏"（如删除后立即过滤掉残留条目） */
  hidePageId: (id: string) => void;
}

export const useWikiStore = create<WikiState>((set, get) => ({
  pagesSpaceId: "",
  pagesData: [],
  pagesLoading: false,
  pagesLoadingMore: false,
  pagesOffset: 0,
  pagesTotal: 0,
  pagesError: null,
  hiddenPageIds: new Set(),

  pageDetails: {},
  pageDetailLoading: {},
  pageDetailInflight: new Set(),

  restoreContent: null,
  isRestore: false,

  loadPages: async (space_id, force = false) => {
    if (!space_id) return;
    const { pagesSpaceId, pagesData, pagesLoading } = get();
    if (!force && pagesSpaceId === space_id && pagesData.length > 0) return;
    if (pagesLoading) return;

    set({ pagesLoading: true, pagesError: null });
    try {
      const data = await wikiApi.pages(space_id, { offset: 0, limit: 100 });

      set({
        pagesSpaceId: space_id,
        pagesData: (data.items ?? []),
        pagesOffset: data.items?.length ?? 0,
        pagesTotal: data.total ?? 0,
        pagesLoading: false,
      });
    } catch (err) {
      set({
        pagesSpaceId: space_id,
        pagesData: [],
        pagesOffset: 0,
        pagesTotal: 0,
        pagesLoading: false,
        pagesError: err instanceof Error ? err.message : String(err),
      });
    }
  },

  loadMorePages: async (space_id) => {
    if (!space_id) return false;
    const { pagesOffset, pagesTotal, pagesLoadingMore, pagesData } = get();
    if (pagesLoadingMore) return false;
    if (pagesOffset >= pagesTotal) return false;

    set({ pagesLoadingMore: true });
    try {
      const data = await wikiApi.pages(space_id, { offset: pagesOffset, limit: 100 });
      const newItems = (data.items ?? []);
      set({
        pagesData: [...pagesData, ...newItems],
        pagesOffset: pagesOffset + newItems.length,
        pagesLoadingMore: false,
      });
      return pagesOffset + newItems.length < (data.total ?? 0);
    } catch {
      set({ pagesLoadingMore: false });
      return false;
    }
  },

  loadPage: async (space_id, slug) => {
    if (!space_id || !slug) return null;
    const { pageDetailInflight, pageDetailLoading } = get();
    // Deduplication: if already in-flight (StrictMode double-invoke), skip
    if (pageDetailInflight.has(slug) || pageDetailLoading[slug]) return null;
    set((s) => ({
      pageDetailLoading: { ...s.pageDetailLoading, [slug]: true },
      pageDetailInflight: new Set(s.pageDetailInflight).add(slug),
    }));
    try {
      const data = await wikiApi.page(space_id, slug);
      set((s) => {
        const nextInflight = new Set(s.pageDetailInflight);
        nextInflight.delete(slug);
        return {
          pageDetails: { ...s.pageDetails, [slug]: data },
          pageDetailLoading: { ...s.pageDetailLoading, [slug]: false },
          pageDetailInflight: nextInflight,
        };
      });
      return data;
    } catch {
      set((s) => {
        const nextInflight = new Set(s.pageDetailInflight);
        nextInflight.delete(slug);
        return {
          pageDetailLoading: { ...s.pageDetailLoading, [slug]: false },
          pageDetailInflight: nextInflight,
        };
      });
      return null;
    }
  },

  resetAll: () => {
    set({
      pagesSpaceId: "",
      pagesData: [],
      pagesLoading: false,
      pagesLoadingMore: false,
      pagesOffset: 0,
      pagesTotal: 0,
      pagesError: null,
      pageDetails: {},
      pageDetailLoading: {},
      pageDetailInflight: new Set(),
      restoreContent: null,
      isRestore: false,
      hiddenPageIds: new Set(),
    });
  },

  clearRestore: () => {
    set({ restoreContent: null, isRestore: false });
  },

  hidePageId: (id: string) => {
    set((s) => {
      if (s.hiddenPageIds.has(id)) return s;
      const next = new Set(s.hiddenPageIds);
      next.add(id);
      return { hiddenPageIds: next };
    });
  },
}));