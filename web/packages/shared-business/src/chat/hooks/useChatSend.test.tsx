/**
 * useChatSend 知识库 ids 优先级链测试
 *
 * 约束(对齐 design.md Decision 1):
 * - networkSearch=true            → knowledge_base_ids = []
 * - hasLinkLibraries=true         → knowledge_base_ids = linkLibraries.map(String)
 * - allKnowledge=true             → knowledge_base_ids = ["all"]
 * - fileInfo 存在                 → knowledge_base_ids = [] (单文件模式不需要 knowledge_base_ids)
 * - 其余                          → knowledge_base_ids = library?.value || []
 *
 * 注意:此文件由 apps/front-react 的 vitest 收集运行(配置 include 包含
 * packages/shared-business/src/**)。shared-business 本身不挂 vitest 依赖。
 */
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { IConversationApi } from "../adapters/types";
import { ChatConfigProvider } from "../i18n";
import { useChatSend } from "./useChatSend";

interface CapturedPayload {
  knowledge_base_ids?: Array<string | number>;
  file_ids?: Array<string | number>;
  space_ids?: Array<string | number>;
}

function createMockConversationApi() {
  const captured: CapturedPayload[] = [];
  const completions = vi.fn(async (params: CapturedPayload) => {
    captured.push(params);
    return { data: { data: "" } };
  });
  const api = {
    create: vi.fn(async () => ({})),
    list: vi.fn(async () => ({})),
    messages: vi.fn(async () => ({})),
    edit: vi.fn(async () => ({})),
    del: vi.fn(async () => ({})),
    completions,
  } as unknown as IConversationApi & { __captured: CapturedPayload[] };
  (api as any).__captured = captured;
  return api;
}

function makeWrapper(api: IConversationApi) {
  // eslint-disable-next-line react/display-name
  return ({ children }: { children?: ReactNode }) => (
    <ChatConfigProvider lang="zh-cn" adapters={{ conversationApi: api }}>
      {children}
    </ChatConfigProvider>
  );
}

/** 在 act() 内调用 sendMessage 以吞掉 React 18 update warning */
async function sendUnderAct(
  sendMessage: (opts: Parameters<ReturnType<typeof useChatSend>["sendMessage"]>[0]) => Promise<unknown>,
  options: Parameters<typeof sendMessage>[0],
) {
  await act(async () => {
    await sendMessage(options);
  });
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("useChatSend.sendMessage — knowledge_base_ids 优先级链", () => {
  it("networkSearch=true 优先:忽略 allKnowledge 与 library,knowledge_base_ids=[]", async () => {
    const api = createMockConversationApi();
    const wrapper = makeWrapper(api);
    const { result } = renderHook(() => useChatSend(), { wrapper });

    await sendUnderAct(result.current.sendMessage, {
      question: "你好",
      agent_id: "agent-1",
      conversation_id: 0,
      modelId: "",
      links: [
        { id: "lib-1", name: "L1", islibrary: true },
        { id: "sp-1", name: "S1", isspace: true },
      ],
      files: [],
      networkSearch: true,
      allKnowledge: true,
      library: { name: "all", value: ["all"], isSpace: false },
      minimalParams: false,
      agentInfo: { agent_id: "agent-1", name: "test" } as any,
    });

    const payload = (api as any).__captured[0] as CapturedPayload;
    expect(payload.knowledge_base_ids).toEqual([]);
  });

  it("hasLinkLibraries=true 优先于 allKnowledge:用具体库 id,不用 ['all']", async () => {
    const api = createMockConversationApi();
    const wrapper = makeWrapper(api);
    const { result } = renderHook(() => useChatSend(), { wrapper });

    await sendUnderAct(result.current.sendMessage, {
      question: "你好",
      agent_id: "agent-1",
      conversation_id: 0,
      modelId: "",
      links: [
        { id: "lib-42", name: "L1", islibrary: true },
        { id: "lib-7", name: "L2", islibrary: true },
      ],
      files: [],
      networkSearch: false,
      allKnowledge: true,
      library: { name: "all", value: ["all"], isSpace: false },
      minimalParams: false,
      agentInfo: { agent_id: "agent-1", name: "test" } as any,
    });

    const payload = (api as any).__captured[0] as CapturedPayload;
    expect(payload.knowledge_base_ids).toEqual(["lib-42", "lib-7"]);
    expect(payload.knowledge_base_ids).not.toContain("all");
  });

  it("allKnowledge=true 且无其他信号:knowledge_base_ids=['all']", async () => {
    const api = createMockConversationApi();
    const wrapper = makeWrapper(api);
    const { result } = renderHook(() => useChatSend(), { wrapper });

    await sendUnderAct(result.current.sendMessage, {
      question: "你好",
      agent_id: "agent-1",
      conversation_id: 0,
      modelId: "",
      links: [],
      files: [],
      networkSearch: false,
      allKnowledge: true,
      minimalParams: false,
      agentInfo: { agent_id: "agent-1", name: "test" } as any,
    });

    const payload = (api as any).__captured[0] as CapturedPayload;
    expect(payload.knowledge_base_ids).toEqual(["all"]);
  });

  it("allKnowledge 缺失 + library?.value 存在:knowledge_base_ids=library.value", async () => {
    const api = createMockConversationApi();
    const wrapper = makeWrapper(api);
    const { result } = renderHook(() => useChatSend(), { wrapper });

    await sendUnderAct(result.current.sendMessage, {
      question: "你好",
      agent_id: "agent-1",
      conversation_id: 0,
      modelId: "",
      links: [],
      files: [],
      networkSearch: false,
      library: { name: "history", value: ["historic-1"], isSpace: false },
      minimalParams: false,
      agentInfo: { agent_id: "agent-1", name: "test" } as any,
    });

    const payload = (api as any).__captured[0] as CapturedPayload;
    expect(payload.knowledge_base_ids).toEqual(["historic-1"]);
  });

  it("allKnowledge 缺失 + fileInfo 存在:knowledge_base_ids=[]", async () => {
    const api = createMockConversationApi();
    const wrapper = makeWrapper(api);
    const { result } = renderHook(() => useChatSend(), { wrapper });

    await sendUnderAct(result.current.sendMessage, {
      question: "你好",
      agent_id: "agent-1",
      conversation_id: 0,
      modelId: "",
      links: [],
      files: [{ id: "f-1", name: "F1" } as any],
      fileInfo: { id: "f-1" },
      networkSearch: false,
      minimalParams: false,
      agentInfo: { agent_id: "agent-1", name: "test" } as any,
    });

    const payload = (api as any).__captured[0] as CapturedPayload;
    expect(payload.knowledge_base_ids).toEqual([]);
  });
});
