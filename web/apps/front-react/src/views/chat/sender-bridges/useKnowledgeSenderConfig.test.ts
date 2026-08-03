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

  it("从 handleSelectFilesFromLibrary 传入 wikis 后,selectedWikiSpaces/selectedWikiPages/wiki 同步", async () => {
    const { result } = renderHook(() => useKnowledgeSenderConfig(baseParams));

    await waitFor(() => {
      expect(result.current).not.toBeNull();
    });

    act(() => {
      result.current!.mention.onSelectFiles?.(
        [],
        [],
        [],
        [
          { id: "s1", name: "空间 A", icon: "", wikiType: "space", type: "wiki" },
          { id: "p1", name: "页面 1", icon: "", title: "页面 1", slug: "p1", wikiType: "page", type: "wiki" },
        ],
      );
    });

    expect(result.current!.knowledgeSource.wiki).toBe(true);
    expect(result.current!.knowledgeSource.mode).toBe("wiki");
    expect(result.current!.knowledgeSource.selectedWikiSpaces).toHaveLength(1);
    expect(result.current!.knowledgeSource.selectedWikiSpaces![0]!.id).toBe("s1");
    expect(result.current!.knowledgeSource.selectedWikiPages).toHaveLength(1);
    expect(result.current!.knowledgeSource.selectedWikiPages![0]!.id).toBe("p1");
  });
});

describe("useKnowledgeSenderConfig — @ 从知识库选择入口(onOpenLibrary)", () => {
  const baseParams = {
    currentAgent: { agent_id: 1, settings: {} },
    enabled: true,
    isInLibrary: false,
  };

  it("未提供 knowledgeSelectorRef 时,mention.onOpenLibrary 为 undefined", async () => {
    const { result } = renderHook(() => useKnowledgeSenderConfig(baseParams));

    await waitFor(() => {
      expect(result.current).not.toBeNull();
    });

    expect(result.current!.mention.onOpenLibrary).toBeUndefined();
  });

  it("提供 knowledgeSelectorRef 时,onOpenLibrary 调用 selector.open()", async () => {
    const open = vi.fn();
    const knowledgeSelectorRef = { current: { reset: vi.fn(), open } };

    const { result } = renderHook(() =>
      useKnowledgeSenderConfig({ ...baseParams, knowledgeSelectorRef })
    );

    await waitFor(() => {
      expect(result.current).not.toBeNull();
      expect(typeof result.current!.mention.onOpenLibrary).toBe("function");
    });

    act(() => {
      result.current!.mention.onOpenLibrary!();
    });

    expect(open).toHaveBeenCalledTimes(1);
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

  it("isInLibrary=true + agent wiki_search_setting 双开门 → wiki=true 且 knowledgeGraph=true", async () => {
    // 修复验证:原先 isInLibrary 分支硬写 wiki=false / knowledgeGraph=false,
    // 导致 /library/:id/chat 路由下动态知识永远不开启。修复后应遵循 settings_obj。
    mocks.libraryStore.library = {
      id: 7,
      name: "测试知识库",
      icon: "folder-icon",
    };

    const { result } = renderHook(() =>
      useKnowledgeSenderConfig({
        currentAgent: {
          agent_id: 1,
          settings: {},
          settings_obj: {
            wiki_search_setting: { enable: true, default_enable: true },
            graph_search_setting: { enable: true, default_enable: true },
          },
        },
        enabled: true,
        isInLibrary: true,
      })
    );

    await waitFor(() => {
      expect(result.current).not.toBeNull();
    });

    expect(result.current!.knowledgeSource.wiki).toBe(true);
    expect(result.current!.knowledgeSource.knowledgeGraph).toBe(true);
    // networkSearch 永远关闭(与 deriveInitialKnowledgeSource 一致)
    expect(result.current!.knowledgeSource.networkSearch).toBe(false);
    // library 仍默认勾选
    expect(result.current!.knowledgeSource.selectedLibraries).toHaveLength(1);
  });

  it("isInLibrary=true + agent settings_obj 缺省 → wiki/knowledgeGraph 默认关闭", async () => {
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

    // 缺省一律 false,不能擅自打开
    expect(result.current!.knowledgeSource.wiki).toBe(false);
    expect(result.current!.knowledgeSource.knowledgeGraph).toBe(false);
  });
});

describe("useKnowledgeSenderConfig — isInLibrary 模式下 reset 保留当前知识库", () => {
  beforeEach(() => {
    mocks.libraryStore.library = {
      id: 7,
      name: "测试知识库",
      icon: "folder-icon",
    };
  });

  it("send 后 knowledgeSource 仍以当前知识库为默认知识源,不退回 allKnowledge", async () => {
    const { result } = renderHook(() =>
      useKnowledgeSenderConfig({
        currentAgent: { agent_id: 1, settings: {} },
        enabled: true,
        isInLibrary: true,
      })
    );

    await waitFor(() => {
      expect(result.current).not.toBeNull();
      expect(result.current!.knowledgeSource.selectedLibraries).toHaveLength(1);
    });

    // 用户临时从弹窗里加了一个文件,模拟 send 时的状态
    act(() => {
      result.current!.mention.onSelectFiles?.(
        [{ id: "999", name: "extra.pdf", icon: "", library_id: "7", isfolder: false, upload_file_id: null, file_size: null, file_mime: null }],
        [{ id: "7", name: "测试知识库", icon: "folder-icon" }],
        [],
      );
    });

    expect(result.current!.knowledgeSource.selectedFiles).toHaveLength(1);

    // 模拟 send 完毕,ChatContainer 调用 reset
    act(() => {
      result.current!.reset();
    });

    // 关键断言:不应回到「全部知识」
    expect(result.current!.knowledgeSource.allKnowledge).toBe(false);
    expect(result.current!.knowledgeSource.mode).toBe("libraries");
    // 当前知识库仍然勾选
    expect(result.current!.knowledgeSource.selectedLibraries).toHaveLength(1);
    expect(result.current!.knowledgeSource.selectedLibraries![0]).toMatchObject({
      id: "7",
      name: "测试知识库",
    });
    // 用户临时勾选的文件被清掉
    expect(result.current!.knowledgeSource.selectedFiles).toEqual([]);
  });

  it("send 后 selectedMentionLinks 保留当前知识库 link,清掉用户临时添加的提及", async () => {
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

    // 用户在输入过程中 @ 了一个文件
    const fileFromRecent = {
      id: "888",
      name: "from-recent.pdf",
      icon: "",
      library_id: "7",
      upload_file_id: null,
      file_size: null,
      file_mime: null,
      isfolder: false,
    };
    act(() => {
      result.current!.mention.onSelect!(fileFromRecent as any);
    });

    expect(result.current!.mention.list?.length).toBeGreaterThan(1);

    // send 完毕
    act(() => {
      result.current!.reset();
    });

    // 仅保留当前知识库 link,临时文件被清掉
    expect(result.current!.mention.list).toHaveLength(1);
    expect(result.current!.mention.list![0]).toMatchObject({
      id: "7",
      islibrary: true,
    });
  });

  it("isInLibrary=false 模式下 reset 仍走默认行为:清空 + allKnowledge=true", async () => {
    const { result } = renderHook(() =>
      useKnowledgeSenderConfig({
        currentAgent: { agent_id: 1, settings: {} },
        enabled: true,
        isInLibrary: false,
      })
    );

    await waitFor(() => {
      expect(result.current).not.toBeNull();
    });

    act(() => {
      result.current!.mention.onSelect!(result.current!.mention.recentList![0]!);
    });

    expect(result.current!.knowledgeSource.selectedFiles.length).toBeGreaterThan(0);

    act(() => {
      result.current!.reset();
    });

    // 非 library 模式保留原行为:send 后回到「全部知识」
    expect(result.current!.knowledgeSource.allKnowledge).toBe(true);
    expect(result.current!.knowledgeSource.mode).toBe("all");
    expect(result.current!.knowledgeSource.selectedFiles).toEqual([]);
    expect(result.current!.mention.list ?? []).toHaveLength(0);
  });
});

describe("useKnowledgeSenderConfig — 默认知识源(strict 双开门)", () => {
  it("后端返回 {} 或完全缺省:默认关闭(不擅自打开)", async () => {
    const cases: Array<{ label: string; settings: any }> = [
      { label: "完全缺省", settings: {} },
      { label: "空对象 {}", settings: { graph_search_setting: {}, wiki_search_setting: {} } },
      { label: "undefined setting", settings: { graph_search_setting: undefined, wiki_search_setting: undefined } },
    ];

    for (const c of cases) {
      const { result } = renderHook(() =>
        useKnowledgeSenderConfig({
          currentAgent: { agent_id: 1, settings_obj: c.settings },
          enabled: true,
          isInLibrary: false,
        })
      );

      await waitFor(() => {
        expect(result.current).not.toBeNull();
      });

      expect(result.current!.knowledgeSource.wiki, `${c.label}: wiki`).toBe(false);
      expect(result.current!.knowledgeSource.knowledgeGraph, `${c.label}: knowledgeGraph`).toBe(false);
      expect(result.current!.knowledgeSource.networkSearch, `${c.label}: networkSearch`).toBe(false);
    }
  });

  it("enable=true 但 default_enable 未设:默认关闭", async () => {
    const { result } = renderHook(() =>
      useKnowledgeSenderConfig({
        currentAgent: {
          agent_id: 1,
          settings_obj: {
            graph_search_setting: { enable: true },
            wiki_search_setting: { enable: true },
          },
        },
        enabled: true,
        isInLibrary: false,
      })
    );

    await waitFor(() => {
      expect(result.current).not.toBeNull();
    });

    expect(result.current!.knowledgeSource.wiki).toBe(false);
    expect(result.current!.knowledgeSource.knowledgeGraph).toBe(false);
  });

  it("enable=true 且 default_enable=true:默认开启", async () => {
    const { result } = renderHook(() =>
      useKnowledgeSenderConfig({
        currentAgent: {
          agent_id: 1,
          settings_obj: {
            graph_search_setting: { enable: true, default_enable: true },
            wiki_search_setting: { enable: true, default_enable: true },
          },
        },
        enabled: true,
        isInLibrary: false,
      })
    );

    await waitFor(() => {
      expect(result.current).not.toBeNull();
    });

    expect(result.current!.knowledgeSource.wiki).toBe(true);
    expect(result.current!.knowledgeSource.knowledgeGraph).toBe(true);
  });

  it("enable=false 即使 default_enable=true:默认关闭", async () => {
    const { result } = renderHook(() =>
      useKnowledgeSenderConfig({
        currentAgent: {
          agent_id: 1,
          settings_obj: {
            graph_search_setting: { enable: false, default_enable: true },
            wiki_search_setting: { enable: false, default_enable: true },
          },
        },
        enabled: true,
        isInLibrary: false,
      })
    );

    await waitFor(() => {
      expect(result.current).not.toBeNull();
    });

    expect(result.current!.knowledgeSource.wiki).toBe(false);
    expect(result.current!.knowledgeSource.knowledgeGraph).toBe(false);
  });
});
