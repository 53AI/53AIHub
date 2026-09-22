import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { dynamicSearchMock } = vi.hoisted(() => ({
  dynamicSearchMock: vi.fn(),
}));

vi.mock("@/api/modules/global-search", () => ({
  globalSearchApi: {
    dynamicSearch: dynamicSearchMock,
  },
}));

import { useDynamicSearch } from "./useDynamicSearch";
import type { FilterParams } from "../types";

const EMPTY_FILTER: FilterParams = {
  spaceIds: [],
  libraryIds: [],
  creatorIds: [],
  fileTypes: [],
};

const SPACE_FILTER: FilterParams = {
  spaceIds: ["space-1"],
  libraryIds: [],
  creatorIds: [],
  fileTypes: [],
};

function makeWikiPage(id: string) {
  return {
    page_id: `page-${id}`,
    slug: `slug-${id}`,
    title: `页面 ${id}`,
    summary: `摘要 ${id}`,
    page_type: "entity",
    library_id: "lib-1",
    library_name: "知识库 1",
    space_id: "space-1",
    space_name: "空间 1",
    created_time: 1750000000000,
    updated_time: 1750000000000,
  };
}

function makeResponse(pageCount: number, total: number, idOffset = 0) {
  return {
    wiki_results: {
      items: Array.from({ length: pageCount }, (_, i) =>
        makeWikiPage(String(idOffset + i + 1)),
      ),
      total,
      page: 1,
      size: 20,
    },
  };
}

beforeEach(() => {
  dynamicSearchMock.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("useDynamicSearch", () => {
  it("关键词变化后发送 sources:[wiki] 载荷", async () => {
    dynamicSearchMock.mockResolvedValue(makeResponse(1, 1));
    renderHook(() => useDynamicSearch("关羽", EMPTY_FILTER));

    await waitFor(() => expect(dynamicSearchMock).toHaveBeenCalled(), { timeout: 1500 });
    expect(dynamicSearchMock).toHaveBeenCalledWith({
      sources: ["wiki"],
      query: "关羽",
      page: 1,
      size: 20,
    });
  });

  it("无关键词时请求最近 wiki 页面（不携带 query key，按最近访问排序）", async () => {
    dynamicSearchMock.mockResolvedValue(makeResponse(5, 5));
    const { result } = renderHook(() => useDynamicSearch("", EMPTY_FILTER));

    await waitFor(() => expect(dynamicSearchMock).toHaveBeenCalled(), { timeout: 1500 });
    expect(dynamicSearchMock).toHaveBeenCalledWith({
      sources: ["wiki"],
      sort_by: "recent_access",
      page: 1,
      size: 20,
    });
    await waitFor(() => expect(result.current.results).toHaveLength(5), { timeout: 1500 });
    expect(result.current.loading).toBe(false);
  });

  it("切换「最近更新」子标签后按 recent_update 排序请求", async () => {
    dynamicSearchMock.mockResolvedValue(makeResponse(3, 3));
    const { result } = renderHook(() => useDynamicSearch("", EMPTY_FILTER));

    await waitFor(() => expect(result.current.results).toHaveLength(3), { timeout: 1500 });
    expect(result.current.mode).toBe("recent_access");

    act(() => result.current.setMode("recent_update"));
    await waitFor(
      () =>
        expect(dynamicSearchMock).toHaveBeenCalledWith({
          sources: ["wiki"],
          sort_by: "recent_update",
          page: 1,
          size: 20,
        }),
      { timeout: 1500 },
    );
    await waitFor(() => expect(result.current.results).toHaveLength(3), { timeout: 1500 });
  });

  it("模式来回切换命中缓存：切回「最近访问」不再发请求且恢复原结果", async () => {
    dynamicSearchMock.mockResolvedValue(makeResponse(4, 4)); // recent_access 首页
    const { result } = renderHook(() => useDynamicSearch("", EMPTY_FILTER));

    await waitFor(() => expect(result.current.results).toHaveLength(4), { timeout: 1500 });

    // 切到「最近更新」：返回 2 条
    dynamicSearchMock.mockResolvedValueOnce(makeResponse(2, 2));
    act(() => result.current.setMode("recent_update"));
    await waitFor(() => expect(result.current.results).toHaveLength(2), { timeout: 1500 });
    const callCount = dynamicSearchMock.mock.calls.length;

    // 切回「最近访问」：命中缓存，无新请求，恢复 4 条
    act(() => result.current.setMode("recent_access"));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 200));
    });
    expect(dynamicSearchMock.mock.calls.length).toBe(callCount);
    expect(result.current.results).toHaveLength(4);
    expect(result.current.loading).toBe(false);
  });

  it("搜索模式下切换模式不触发请求，清空关键词后按当前模式请求", async () => {
    dynamicSearchMock.mockResolvedValue(makeResponse(1, 1));
    const { result, rerender } = renderHook(({ q }: { q: string }) => useDynamicSearch(q, EMPTY_FILTER), {
      initialProps: { q: "关羽" },
    });

    await waitFor(() => expect(dynamicSearchMock).toHaveBeenCalled(), { timeout: 1500 });
    dynamicSearchMock.mockClear();

    // 搜索模式下切模式：不应发请求
    act(() => result.current.setMode("recent_update"));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 200));
    });
    expect(dynamicSearchMock).not.toHaveBeenCalled();

    // 清空关键词：按当前模式（recent_update）请求最近页面
    rerender({ q: "" });
    await waitFor(
      () =>
        expect(dynamicSearchMock).toHaveBeenCalledWith({
          sources: ["wiki"],
          sort_by: "recent_update",
          page: 1,
          size: 20,
        }),
      { timeout: 1500 },
    );
  });

  it("筛选变化后重新请求：携带 space_ids 且不再按最近访问排序", async () => {
    dynamicSearchMock.mockResolvedValue(makeResponse(2, 2));
    const { rerender } = renderHook(
      ({ q, f }: { q: string; f: FilterParams }) => useDynamicSearch(q, f),
      { initialProps: { q: "", f: EMPTY_FILTER } },
    );
    await waitFor(() => expect(dynamicSearchMock).toHaveBeenCalled(), { timeout: 1500 });

    dynamicSearchMock.mockClear();
    rerender({ q: "", f: SPACE_FILTER });
    await waitFor(() => expect(dynamicSearchMock).toHaveBeenCalled(), { timeout: 1500 });

    expect(dynamicSearchMock).toHaveBeenCalledWith({
      sources: ["wiki"],
      space_ids: ["space-1"],
      page: 1,
      size: 20,
    });
  });

  it("防抖窗口内清空关键词：已取消的关键词请求不触发，仅发最近请求（Bug A）", async () => {
    dynamicSearchMock.mockResolvedValue(makeResponse(1, 1));
    const { rerender } = renderHook(({ q }: { q: string }) => useDynamicSearch(q, EMPTY_FILTER), {
      initialProps: { q: "关" },
    });

    // 300ms 防抖窗口内清空
    rerender({ q: "" });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 400));
    });

    // 被取消的关键词搜索不应发出
    expect(dynamicSearchMock.mock.calls.some((c) => c[0].query === "关")).toBe(false);
    // 清空后触发最近页面请求（不携带 query key，按最近访问排序）
    expect(dynamicSearchMock).toHaveBeenCalledWith({
      sources: ["wiki"],
      sort_by: "recent_access",
      page: 1,
      size: 20,
    });
  });

  it("加载更多进行中清空关键词后，loadingMore 复位、分页不卡死（Bug B-清空）", async () => {
    let resolveLoadMore: (v: unknown) => void;
    dynamicSearchMock
      .mockImplementationOnce(() => Promise.resolve(makeResponse(20, 40))) // 首页 20/40，hasMore=true
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveLoadMore = resolve;
          }),
      ) // 加载更多挂起
      .mockImplementationOnce(() => Promise.resolve(makeResponse(5, 5))); // 清空后的最近请求

    const { result, rerender } = renderHook(({ q }: { q: string }) => useDynamicSearch(q, EMPTY_FILTER), {
      initialProps: { q: "关" },
    });

    await waitFor(() => expect(result.current.results).toHaveLength(20), { timeout: 1500 });
    expect(result.current.hasMore).toBe(true);

    // 触发加载更多（挂起中）
    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.loadingMore).toBe(true), { timeout: 1000 });

    // 清空关键词（加载更多仍在挂起）→ 触发最近请求
    rerender({ q: "" });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 100));
    });
    expect(result.current.loadingMore).toBe(false);
    expect(result.current.hasMore).toBe(false);
    // 最近请求返回 5 条
    await waitFor(() => expect(result.current.results).toHaveLength(5), { timeout: 1500 });

    // 挂起的加载更多响应最终返回后，也不应卡死分页
    await act(async () => {
      resolveLoadMore!(makeResponse(10, 40));
    });
    expect(result.current.loadingMore).toBe(false);
  });

  it("加载更多进行中输入新关键词，分页不卡死（Bug B-换词）", async () => {
    let resolveOldLoadMore: (v: unknown) => void;
    dynamicSearchMock
      .mockImplementationOnce(() => Promise.resolve(makeResponse(20, 40))) // "关" 首页 20/40
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveOldLoadMore = resolve;
          }),
      ) // "关" 加载更多挂起
      .mockImplementationOnce(() => Promise.resolve(makeResponse(20, 40))); // "羽" 首页 20/40，可继续加载更多

    const { result, rerender } = renderHook(({ q }: { q: string }) => useDynamicSearch(q, EMPTY_FILTER), {
      initialProps: { q: "关" },
    });

    await waitFor(() => expect(result.current.results).toHaveLength(20), { timeout: 1500 });

    // 触发 "关" 的加载更多（挂起）
    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.loadingMore).toBe(true), { timeout: 1000 });

    // 防抖窗口后换词 "羽"：应复位 loadingMore 并触发新首搜
    await act(async () => {
      await new Promise((r) => setTimeout(r, 400));
    });
    rerender({ q: "羽" });
    await waitFor(() => expect(result.current.loadingMore).toBe(false), { timeout: 1500 });
    await waitFor(() => expect(result.current.results).toHaveLength(20), { timeout: 1500 });
    expect(result.current.hasMore).toBe(true);

    // 旧的挂起加载更多最终返回，也不应再卡死分页
    await act(async () => {
      resolveOldLoadMore!(makeResponse(10, 40));
    });
    expect(result.current.loadingMore).toBe(false);

    // 新词 "羽" 仍能继续加载更多（挂起以观察 loadingMore 置位）
    let resolveNewLoadMore: (v: unknown) => void;
    dynamicSearchMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveNewLoadMore = resolve;
        }),
    );
    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.loadingMore).toBe(true), { timeout: 1000 });
    await act(async () => {
      resolveNewLoadMore!(makeResponse(5, 40, 20)); // 第 2 页（id 21-25），总数 40
    });
    await waitFor(() => expect(result.current.results).toHaveLength(25), { timeout: 1500 });
    expect(result.current.loadingMore).toBe(false);
    expect(result.current.hasMore).toBe(true);
  });

  it("再次输入关键词触发新搜索", async () => {
    dynamicSearchMock.mockResolvedValue(makeResponse(1, 1));
    const { rerender } = renderHook(({ q }: { q: string }) => useDynamicSearch(q, EMPTY_FILTER), {
      initialProps: { q: "关" },
    });

    rerender({ q: "" });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 400));
    });
    dynamicSearchMock.mockClear();

    rerender({ q: "羽" });
    await waitFor(() => expect(dynamicSearchMock).toHaveBeenCalled(), { timeout: 1500 });
    expect(dynamicSearchMock).toHaveBeenCalledWith({
      sources: ["wiki"],
      query: "羽",
      page: 1,
      size: 20,
    });
  });
});
