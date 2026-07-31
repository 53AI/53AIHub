import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useWikiPageList } from "./useWikiPageList";
import type { UseWikiPageListArgs } from "./useWikiPageList";
import wikiApi from "@/api/modules/wiki";
import type { WikiPageItem } from "@/api/modules/wiki";

vi.mock("@/api/modules/wiki", () => ({
  default: { pages: vi.fn() },
}));

const mockedPages = vi.mocked(wikiApi.pages);

function makeItem(id: number): WikiPageItem {
  return { id: String(id), slug: `slug-${id}`, title: `T${id}` } as WikiPageItem;
}

// 3 条数据，按 offset/limit 分页返回
function pagedResponder(total: number) {
  return async (_spaceId: string, params?: { offset?: number; limit?: number }) => {
    const offset = params?.offset ?? 0;
    const limit = params?.limit ?? 30;
    const items = Array.from({ length: total }, (_, i) => makeItem(i + 1)).slice(
      offset,
      offset + limit,
    );
    return { items, total, libraries: [] };
  };
}

const baseArgs: UseWikiPageListArgs = {
  spaceId: "space-1",
  pageType: "concept",
  keyword: "",
  sortBy: "updated_time",
  sortOrder: "desc",
  limit: 2,
};

afterEach(() => {
  vi.clearAllMocks();
});

describe("useWikiPageList", () => {
  it("挂载时加载第一页", async () => {
    mockedPages.mockImplementation(pagedResponder(3));
    const { result } = renderHook(() => useWikiPageList(baseArgs));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.items.map((i) => i.id)).toEqual(["1", "2"]);
    expect(result.current.total).toBe(3);
    expect(result.current.hasMore).toBe(true);
  });

  it("loadMore 追加下一页并在加载完全部后 hasMore=false", async () => {
    mockedPages.mockImplementation(pagedResponder(3));
    const { result } = renderHook(() => useWikiPageList(baseArgs));
    await waitFor(() => expect(result.current.items).toHaveLength(2));

    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.items).toHaveLength(3));
    expect(result.current.items.map((i) => i.id)).toEqual(["1", "2", "3"]);
    expect(result.current.hasMore).toBe(false);

    // 已到底，再次 loadMore 不应再请求
    const callsBefore = mockedPages.mock.calls.length;
    act(() => result.current.loadMore());
    await Promise.resolve();
    expect(mockedPages.mock.calls.length).toBe(callsBefore);
  });

  it("查询条件变化时重置并重新请求第一页", async () => {
    mockedPages.mockImplementation(pagedResponder(3));
    const { result, rerender } = renderHook((props) => useWikiPageList(props), {
      initialProps: baseArgs,
    });
    await waitFor(() => expect(result.current.items).toHaveLength(2));
    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.items).toHaveLength(3));

    rerender({ ...baseArgs, pageType: "entity" });
    await waitFor(() => expect(result.current.items).toHaveLength(2));
    // 从头开始，offset 归零
    const lastCall = mockedPages.mock.calls.at(-1)?.[1];
    expect(lastCall?.offset).toBe(0);
    expect(lastCall?.page_type).toBe("entity");
  });

  it("空 spaceId 不请求", async () => {
    mockedPages.mockImplementation(pagedResponder(3));
    renderHook(() => useWikiPageList({ ...baseArgs, spaceId: "" }));
    await Promise.resolve();
    expect(mockedPages).not.toHaveBeenCalled();
  });

  it("reload 从第一页强制刷新", async () => {
    mockedPages.mockImplementation(pagedResponder(3));
    const { result } = renderHook(() => useWikiPageList(baseArgs));
    await waitFor(() => expect(result.current.items).toHaveLength(2));

    act(() => result.current.reload());
    await waitFor(() => expect(result.current.items).toHaveLength(2));
    expect(mockedPages.mock.calls.at(-1)?.[1]?.offset).toBe(0);
  });
});
