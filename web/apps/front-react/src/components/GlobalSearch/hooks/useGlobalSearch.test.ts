import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { spacesMock, librariesMock, searchMock, quickTagsMock } = vi.hoisted(() => ({
  spacesMock: vi.fn(),
  librariesMock: vi.fn(),
  searchMock: vi.fn(),
  quickTagsMock: vi.fn(),
}));

vi.mock("@/api/modules/global-search", () => ({
  globalSearchApi: {
    spaces: spacesMock,
    libraries: librariesMock,
    search: searchMock,
    quickTags: quickTagsMock,
  },
}));

vi.mock("@/api/modules/files/transform", () => ({
  formatFileInfo: (name: string) => ({ fname: name, icon: "" }),
}));

import { useGlobalSearch } from "./useGlobalSearch";
import type { FilterParams } from "../types";

const FILTER_PARAMS_EMPTY: FilterParams = {
  spaceIds: [],
  libraryIds: [],
  creatorIds: [],
  fileTypes: [],
};

const FILTER_PARAMS_WITH_CREATOR_AND_TIME: FilterParams = {
  spaceIds: [],
  libraryIds: [],
  creatorIds: [42, 99],
  fileTypes: [],
  createdTimeFrom: -604800000, // 7d 相对时间戳
  updatedTimeFrom: -2592000000, // 30d 相对时间戳
};

function makeSearchResponse() {
  return { rag_results: { items: [], total: 0, page: 1, size: 20 } };
}

beforeEach(() => {
  spacesMock.mockReset().mockResolvedValue([]);
  librariesMock.mockReset().mockResolvedValue([]);
  searchMock.mockReset().mockImplementation(makeSearchResponse);
  quickTagsMock.mockReset().mockResolvedValue({ spaces: [], libraries: [] });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("useGlobalSearch - spaces/libraries params forwarding", () => {
  it("无筛选时，搜索关键词仅携带 keyword", async () => {
    const { result } = renderHook(() => useGlobalSearch("test", FILTER_PARAMS_EMPTY));
    act(() => result.current.refresh());

    await waitFor(() => expect(spacesMock).toHaveBeenCalled(), { timeout: 1000 });
    await waitFor(() => expect(librariesMock).toHaveBeenCalled(), { timeout: 1000 });

    expect(spacesMock).toHaveBeenLastCalledWith({ keyword: "test" });
    expect(librariesMock).toHaveBeenLastCalledWith({ keyword: "test" });
  });

  it("带 creator_ids 与 created_time_from/updated_time_from 时，三个参数都被透传到 spaces 和 libraries", async () => {
    const { result } = renderHook(() =>
      useGlobalSearch("hello", FILTER_PARAMS_WITH_CREATOR_AND_TIME),
    );
    act(() => result.current.refresh());

    await waitFor(() => expect(spacesMock).toHaveBeenCalled(), { timeout: 1000 });
    await waitFor(() => expect(librariesMock).toHaveBeenCalled(), { timeout: 1000 });

    const expected = {
      keyword: "hello",
      creator_ids: [42, 99],
      created_time_from: -604800000,
      updated_time_from: -2592000000,
    };

    expect(spacesMock).toHaveBeenLastCalledWith(expected);
    expect(librariesMock).toHaveBeenLastCalledWith(expected);
  });

  it("筛选条件变化后再次搜索时，新的参数被透传", async () => {
    const { result, rerender } = renderHook(
      ({ q, p }: { q: string; p: FilterParams }) => useGlobalSearch(q, p),
      { initialProps: { q: "abc", p: FILTER_PARAMS_EMPTY } },
    );
    act(() => result.current.refresh());
    await waitFor(() => expect(spacesMock).toHaveBeenCalled(), { timeout: 1000 });

    const callsBefore = spacesMock.mock.calls.length;

    rerender({ q: "abc", p: FILTER_PARAMS_WITH_CREATOR_AND_TIME });

    await waitFor(() => expect(spacesMock.mock.calls.length).toBeGreaterThan(callsBefore), {
      timeout: 1500,
    });
    await waitFor(() => expect(librariesMock).toHaveBeenCalled(), { timeout: 1000 });

    expect(spacesMock).toHaveBeenLastCalledWith({
      keyword: "abc",
      creator_ids: [42, 99],
      created_time_from: -604800000,
      updated_time_from: -2592000000,
    });
  });
});

describe("useGlobalSearch - enabled 门控（只在知识文档 tab 搜索）", () => {
  it("enabled=false 时不触发知识搜索（如处于动态知识 tab）", async () => {
    const { result } = renderHook(() =>
      useGlobalSearch("foo", FILTER_PARAMS_EMPTY, false),
    );
    act(() => result.current.refresh());

    // 即便初始化后有关键词，也不应发请求
    await vi.waitFor(() => expect(result.current.isSearchMode).toBe(true), { timeout: 1000 });
    expect(spacesMock).not.toHaveBeenCalled();
    expect(librariesMock).not.toHaveBeenCalled();
    expect(searchMock).not.toHaveBeenCalled();
  });

  it("切换为 enabled=true 后按当前关键词搜索", async () => {
    const { result, rerender } = renderHook(
      ({ q, enabled }: { q: string; enabled: boolean }) =>
        useGlobalSearch(q, FILTER_PARAMS_EMPTY, enabled),
      { initialProps: { q: "foo", enabled: false } },
    );
    act(() => result.current.refresh());
    await vi.waitFor(() => expect(result.current.isSearchMode).toBe(true), { timeout: 1000 });
    expect(spacesMock).not.toHaveBeenCalled();

    // 切回知识文档 tab
    rerender({ q: "foo", enabled: true });

    await waitFor(() => expect(searchMock).toHaveBeenCalled(), { timeout: 1500 });
    expect(searchMock).toHaveBeenCalledWith(
      expect.objectContaining({ query: "foo", page: 1 }),
    );
  });

  it("防抖窗口内切出 tab：待执行的搜索被取消，不发请求", async () => {
    const { result, rerender } = renderHook(
      ({ q, enabled }: { q: string; enabled: boolean }) =>
        useGlobalSearch(q, FILTER_PARAMS_EMPTY, enabled),
      { initialProps: { q: "foo", enabled: true } },
    );
    act(() => result.current.refresh());

    // 在 300ms 防抖窗口内切到动态知识 tab（enabled=false）
    rerender({ q: "foo", enabled: false });

    // 等待超过防抖窗口，确认被取消的搜索没有发出
    await vi.waitFor(() => expect(result.current.isSearchMode).toBe(true), { timeout: 1000 });
    expect(searchMock).not.toHaveBeenCalled();
    expect(spacesMock).not.toHaveBeenCalled();
    expect(librariesMock).not.toHaveBeenCalled();
  });
});
