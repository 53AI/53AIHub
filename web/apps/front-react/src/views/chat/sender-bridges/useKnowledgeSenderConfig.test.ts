/**
 * useKnowledgeSenderConfig — 联动测试
 *
 * 关注点:@ 选中 recentList / suggestions 中的文件后,knowledgeSource 也应同步
 * 包含该文件(KnowledgeSourceSelector 才会勾选)。
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  userStore: { info: { eid: "user-1", is_internal: 1, access_token: "token-1" }, is_login: true },
  navigationStore: { hasKnowledge: true },
  // 改为可写对象,afterEach 复位
  libraryStore: { library: null as any },
  spaceStore: { loadSpaceList: vi.fn() },
  recentFiles: [
    { id: 100, path: "docs/a.pdf", type: 1, library_id: 1, upload_file: { size: 1024 } },
    { id: 200, path: "docs/b.docx", type: 1, library_id: 1, upload_file: { size: 2048 } },
  ],
  searchResults: { results: [] as any[] },
}));

vi.mock("@/stores/modules/user", () => ({
  useUserStore: (selector?: any) => (selector ? selector(mocks.userStore) : mocks.userStore),
}));

vi.mock("@/stores/modules/navigation", () => ({
  useNavigationStore: (selector?: any) => (selector ? selector(mocks.navigationStore) : mocks.navigationStore),
}));

vi.mock("@/stores/modules/library", () => ({
  useLibraryStore: (selector?: any) => (selector ? selector(mocks.libraryStore) : mocks.libraryStore),
}));

vi.mock("@/stores/modules/space", () => ({
  useSpaceStore: (selector?: any) => (selector ? selector(mocks.spaceStore) : mocks.spaceStore),
}));

vi.mock("@/api/modules/agents/index", () => ({
  default: {
    models: {
      list: vi.fn().mockResolvedValue({ agent_models: [] }),
    },
  },
}));

vi.mock("@/api/modules/files", () => ({
  filesApi: {
    recently: vi.fn().mockResolvedValue(mocks.recentFiles),
    search: vi.fn().mockResolvedValue(mocks.searchResults),
  },
}));

vi.mock("@/api/modules/files/transform", () => ({
  formatFile: (f: any) => ({
    ...f,
    name: f.path?.split("/").pop() || `file-${f.id}`,
    isfolder: false,
    isfile: true,
    icon: "",
  }),
}));

vi.mock("@/api/modules/agents/transform", () => ({
  transformAgentInfo: (a: any) => a,
}));

vi.mock("@/locales", () => ({
  t: (key: string) => key,
}));

vi.mock("@km/shared-utils", () => ({
  cacheManager: { get: vi.fn().mockResolvedValue(null) },
  CacheMode: { LOCAL_STORAGE: "local" },
  eventBus: { on: vi.fn(), off: vi.fn(), emit: vi.fn() },
  formatFileInfo: () => ({ ext: "", mime: "", fname: "", icon: "" }),
}));

import { useKnowledgeSenderConfig } from "./useKnowledgeSenderConfig";

afterEach(() => {
  mocks.libraryStore.library = null;
  vi.clearAllMocks();
});

describe("useKnowledgeSenderConfig — @ 联动 knowledgeSource", () => {
  const baseParams = {
    currentAgent: { agent_id: 1, settings: {} },
    enabled: true,
    isInLibrary: false,
  };

  it("选中 recentList 中的文件后,knowledgeSource.selectedFiles 同步追加该文件", async () => {
    const { result } = renderHook(() => useKnowledgeSenderConfig(baseParams));

    // 等待 recentList 加载
    await waitFor(() => {
      expect(result.current).not.toBeNull();
      expect(result.current!.mention.recentList).toHaveLength(2);
    });

    // 初始 knowledgeSource 应为 all
    expect(result.current!.knowledgeSource.mode).toBe("all");
    expect(result.current!.knowledgeSource.allKnowledge).toBe(true);
    expect(result.current!.knowledgeSource.selectedFiles).toEqual([]);

    // 模拟用户选中 recentList 第一项
    const target = result.current!.mention.recentList![0]!;
    act(() => {
      result.current!.mention.onSelect!(target);
    });

    // knowledgeSource 应被同步
    expect(result.current!.knowledgeSource.mode).toBe("files");
    expect(result.current!.knowledgeSource.allKnowledge).toBe(false);
    expect(result.current!.knowledgeSource.selectedFiles).toHaveLength(1);
    expect(result.current!.knowledgeSource.selectedFiles[0]!).toMatchObject({
      id: String(target.id),
      name: target.name,
    });
  });

  it("重复选中同一文件不会重复追加到 knowledgeSource.selectedFiles", async () => {
    const { result } = renderHook(() => useKnowledgeSenderConfig(baseParams));

    await waitFor(() => {
      expect(result.current!.mention.recentList?.length ?? 0).toBeGreaterThan(0);
    });

    const target = result.current!.mention.recentList![0]!;

    act(() => {
      result.current!.mention.onSelect!(target);
      result.current!.mention.onSelect!(target);
    });

    expect(result.current!.knowledgeSource.selectedFiles).toHaveLength(1);
  });

  it("从 handleSelectFilesFromLibrary(等价于 SpaceDialog 选中)走完后,knowledgeSource 与 selectedMentionLinks 同步", async () => {
    const { result } = renderHook(() => useKnowledgeSenderConfig(baseParams));

    await waitFor(() => {
      expect(result.current!.mention.recentList?.length ?? 0).toBeGreaterThan(0);
    });

    // 调用 mention.onSelectFiles(对齐 SpaceDialog 选中后的回调)
    act(() => {
      result.current!.mention.onSelectFiles?.(
        [{ id: "999", name: "from-dialog.pdf", icon: "", library_id: "7" }],
        [{ id: "7", name: "lib-1", icon: "" }],
        [],
      );
    });

    expect(result.current!.knowledgeSource.selectedFiles).toHaveLength(1);
    expect(result.current!.knowledgeSource.selectedFiles[0]!.id).toBe("999");
    expect(result.current!.knowledgeSource.selectedLibraries?.[0]?.id).toBe("7");
    expect(result.current!.mention.list?.length ?? 0).toBeGreaterThan(0);
  });
});

describe("useKnowledgeSenderConfig — isInLibrary 模式自动勾选", () => {
  it("isInLibrary=true + useLibraryStore.library 已就绪 → selectedLibraries 含当前库", async () => {
    // 准备:在测试内覆盖 mocks.libraryStore.library
    mocks.libraryStore.library = {
      id: 7,
      name: "测试知识库",
      icon: "folder-icon",
    };

    const { result } = renderHook(() =>
      useKnowledgeSenderConfig({
        currentAgent: { agent_id: 1, settings: {} },
        enabled: true,
        isInLibrary: true,
      })
    );

    await waitFor(() => {
      expect(result.current).not.toBeNull();
    });

    // 1) knowledgeSource 注入当前库
    expect(result.current!.knowledgeSource.selectedLibraries).toHaveLength(1);
    expect(result.current!.knowledgeSource.selectedLibraries![0]).toMatchObject({
      id: "7",
      name: "测试知识库",
      icon: "folder-icon",
    });
    // 2) allKnowledge = false(配合 useChatSend 的 knowledge_base_ids 计算)
    expect(result.current!.knowledgeSource.allKnowledge).toBe(false);
    // 3) selectedMentionLinks 同步注入了 islibrary:true 的 link
    expect(result.current!.mention.list).toHaveLength(1);
    expect(result.current!.mention.list![0]).toMatchObject({
      id: "7",
      islibrary: true,
    });
  });
});
