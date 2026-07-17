/**
 * 回归测试：覆盖 useChatSend 修复的两个缺失调用
 *
 * 1. 发送时调用 recentUsed.save 保存 @ 文件/知识库/空间的最近使用记录
 * 2. 发送后异步同步 agentRun.currentRun，让 handleStop 时 cancel() 能调用关闭接口
 *
 * 旧版实现位于 apps/front-react/src/useChatSend.ts，新版位于
 * packages/shared-business/src/chat/hooks/useChatSend.ts。
 */
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ChatConfigProvider,
  useChatSend,
  type IConversationApi,
} from "@km/shared-business/chat";

function makeConversationApi() {
  const completions = vi.fn(async (_payload: any, _options: any) => {
    // 模拟立即结束，不发任何流式数据
  });
  return {
    create: vi.fn(),
    list: vi.fn(),
    messages: vi.fn(),
    edit: vi.fn(),
    del: vi.fn(),
    completions,
  } as unknown as IConversationApi;
}

function wrapWithAdapters(adapters: Record<string, unknown>) {
  return ({ children }: { children: ReactNode }) => (
    <ChatConfigProvider
      adapters={adapters as any}
    >
      {children}
    </ChatConfigProvider>
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useChatSend fixes: recentUsed + agentRun cancel", () => {
  it("calls recentUsed.save when links are present in non-agent mode", async () => {
    const conversationApi = makeConversationApi();
    const recentUsedSave = vi.fn().mockResolvedValue(undefined);

    const { result } = renderHook(() => useChatSend(), {
      wrapper: wrapWithAdapters({
        conversationApi,
        recentUsed: { save: recentUsedSave },
        agentApi: { detail: vi.fn(), list: vi.fn(), myDetail: vi.fn(), myList: vi.fn() },
        workflowApi: { run: vi.fn() },
      }),
    });

    const links = [
      { id: "lib-1", islibrary: true },        // 知识库
      { id: "file-1", islibrary: false },      // 文件
      { id: "space-1", isspace: true },        // 空间
    ];

    await act(async () => {
      await result.current.sendMessage({
        question: "test",
        agent_id: "1",
        conversation_id: "conv-1",
        links,
        type: "knowledge", // 非 agent 模式
        minimalParams: false,
        onMessageListChange: () => {},
      });
    });

    expect(recentUsedSave).toHaveBeenCalledTimes(1);
    const savedItems = recentUsedSave.mock.calls[0][0];
    expect(savedItems).toHaveLength(3);
    expect(savedItems).toEqual([
      { resource_type: 1, resource_id: "lib-1" },
      { resource_type: 2, resource_id: "file-1" },
      { resource_type: 0, resource_id: "space-1" },
    ]);
  });

  it("does NOT call recentUsed.save in agent mode (minimalParams + type='agent')", async () => {
    const conversationApi = makeConversationApi();
    const recentUsedSave = vi.fn();

    const { result } = renderHook(() => useChatSend(), {
      wrapper: wrapWithAdapters({
        conversationApi,
        recentUsed: { save: recentUsedSave },
        agentApi: { detail: vi.fn(), list: vi.fn(), myDetail: vi.fn(), myList: vi.fn() },
        workflowApi: { run: vi.fn() },
      }),
    });

    await act(async () => {
      await result.current.sendMessage({
        question: "test",
        agent_id: "1",
        conversation_id: "conv-1",
        links: [{ id: "file-1" }],
        type: "agent",
        minimalParams: true,
        onMessageListChange: () => {},
      });
    });

    expect(recentUsedSave).not.toHaveBeenCalled();
  });

  it("calls agentRun.cancel with the run_id synced from latest after send", async () => {
    const conversationApi = makeConversationApi();

    const runInfo = {
      id: "run-uuid",
      run_id: "run-uuid",
      conversation_id: "conv-1",
      message_id: "msg-1",
      status: "running" as const,
      created_at: "",
      updated_at: "",
    };
    const latest = vi.fn().mockResolvedValue({ run: runInfo, isrunning: true });
    const cancel = vi.fn().mockResolvedValue(undefined);
    const recover = vi.fn();
    const subscribe = vi.fn();

    const agentRunApi = { latest, cancel, recover, subscribe };

    const { result } = renderHook(() => useChatSend(), {
      wrapper: wrapWithAdapters({
        conversationApi,
        agentRun: agentRunApi,
        agentApi: { detail: vi.fn(), list: vi.fn(), myDetail: vi.fn(), myList: vi.fn() },
        workflowApi: { run: vi.fn() },
      }),
    });

    await act(async () => {
      await result.current.sendMessage({
        question: "test",
        agent_id: "1",
        conversation_id: "conv-1",
        links: [],
        type: "agent",
        minimalParams: true,
        onMessageListChange: () => {},
      });
      // 让 fire-and-forget 的 latest().then(...) microtask 执行
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(latest).toHaveBeenCalledWith("conv-1");

    // 此时 currentRun 应已通过 setCurrentRun 回填
    // handleStop 应该触发 agentRun.cancel(run_id)
    act(() => {
      result.current.handleStop();
    });

    expect(cancel).toHaveBeenCalledWith("run-uuid");
  });

  it("does not call cancel when no run was found via latest", async () => {
    const conversationApi = makeConversationApi();
    const latest = vi.fn().mockResolvedValue({ run: null, isrunning: false });
    const cancel = vi.fn();

    const { result } = renderHook(() => useChatSend(), {
      wrapper: wrapWithAdapters({
        conversationApi,
        agentRun: { latest, cancel, recover: vi.fn(), subscribe: vi.fn() },
        agentApi: { detail: vi.fn(), list: vi.fn(), myDetail: vi.fn(), myList: vi.fn() },
        workflowApi: { run: vi.fn() },
      }),
    });

    await act(async () => {
      await result.current.sendMessage({
        question: "test",
        agent_id: "1",
        conversation_id: "conv-1",
        links: [],
        type: "agent",
        minimalParams: true,
        onMessageListChange: () => {},
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    act(() => {
      result.current.handleStop();
    });

    expect(cancel).not.toHaveBeenCalled();
  });
});