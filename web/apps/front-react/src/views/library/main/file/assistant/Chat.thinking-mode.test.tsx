import { createRef } from "react";
import type { ReactNode, Ref } from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ChatAssistant from "./Chat";
import type { ChatRef } from "./Chat";

const { sendMessage, agentsList, createConversation } = vi.hoisted(() => ({
  sendMessage: vi.fn(async () => undefined),
  agentsList: vi.fn(async () => ({
    agent_models: [
      { id: 7, channel_id: 9, channel_type: 1, model: "same-model" },
      { id: 7, channel_id: 9, channel_type: 1, model: "same-model" },
    ],
  })),
  createConversation: vi.fn(async () => ({ conversation_id: 43 })),
}));

vi.mock("antd", () => ({
  Button: () => null,
  Checkbox: () => null,
  Tooltip: ({ children }: { children: React.ReactNode }) => children,
  message: { warning: vi.fn() },
}));

vi.mock("@km/shared-components-react", () => ({
  Dropdown: ({
    menu,
    children,
  }: {
    menu: { items: Array<{ key: string; onClick: () => void }> };
    children: ReactNode;
  }) => (
    <>
      {children}
      {menu.items.map((item) => (
        <button key={item.key} type="button" aria-label={item.key} onClick={item.onClick} />
      ))}
    </>
  ),
  SvgIcon: () => null,
}));

vi.mock("@/locales", () => ({ t: (key: string) => key }));
vi.mock("@/utils/router", () => ({ buildKnowledgeFileUrl: vi.fn() }));
vi.mock("@/utils/config", () => ({ getPublicPath: vi.fn() }));
vi.mock("@/components/Chat", async () => {
  const React = await vi.importActual<typeof import("react")>("react");
  return {
    Sender: ({ extras }: { extras: ReactNode }) => <>{extras}</>,
    MessageMenu: () => null,
    AddAnswerAsMd: React.forwardRef(() => null),
    addAnswerAsMdApi: vi.fn(),
  };
});
vi.mock("@km/shared-business/chat", async () => {
  const React = await vi.importActual<typeof import("react")>("react");
  return {
    FeedbackPanel: () => null,
    RagHeader: () => null,
    SpecifiedFiles: () => null,
    ShareHeader: () => null,
    Chunk: React.forwardRef(() => null),
    ThinkKnowledge: () => null,
    ChatConfigProvider: ({ children }: { children: ReactNode }) => children,
    useChatMessages: () => ({
      state: { messageList: [], hasMore: false, isLoadingMore: false },
      loadMessageList: vi.fn(),
      handleLoadListMore: vi.fn(),
      handleRegenerate: vi.fn(),
      handleSourceReferenceHover: vi.fn(),
      renderSource: vi.fn(),
      handleOpenKnow: vi.fn(),
      clearMessageList: vi.fn(),
      updateMessageList: vi.fn(),
    }),
    useChatSend: () => ({ sendMessage, handleStop: vi.fn() }),
    useChatFeedback: () => ({
      loadFeedbackConfig: vi.fn(),
      handleClickFeedbackBtn: vi.fn(),
      handleToggleFeedbackBtn: vi.fn(),
      handleCloseFeedback: vi.fn(),
      handleSubmitFeedback: vi.fn(),
      resetFeedbackSuccessState: vi.fn(),
    }),
    useChatShare: () => ({
      state: { selectAll: false, selectMessageIds: [] },
      isShareMode: false,
      handleSelectAll: vi.fn(),
      handleOpenShare: vi.fn(),
      handleSelectMessage: vi.fn(),
      handleCreateShare: vi.fn(),
    }),
  };
});
vi.mock("@/components/Model/view", () => ({ ModelView: () => null }));
vi.mock("./components/ChatHistoryDrawer", () => ({ ChatHistoryDrawer: () => null }));
vi.mock("@km/hub-ui-x-react", async () => {
  const React = await vi.importActual<typeof import("react")>("react");
  return {
    BubbleList: React.forwardRef(
      ({ children }: { children: ReactNode }, _ref: Ref<unknown>) => (
        <div>{children}</div>
      ),
    ),
    BubbleUser: () => null,
    BubbleAssistant: () => null,
  };
});
vi.mock("./conversation", () => ({
  useFileConversationStore: () => ({
    current_conversationid: 0,
    currentConversation: () => ({ conversation_id: 0 }),
    createConversation,
    addConversation: vi.fn(),
    setCurrentState: vi.fn(),
  }),
}));
vi.mock("@/stores/modules/user", () => ({ useUserStore: () => ({ info: {} }) }));
vi.mock("@/stores/modules/enterprise", () => ({
  useEnterpriseStore: (selector: (state: { language: string }) => unknown) =>
    selector({ language: "zh-cn" }),
}));
vi.mock("@/stores/modules/space", () => ({
  useSpaceStore: () => ({ space: {}, loadFile: vi.fn() }),
}));
vi.mock("@/hooks/usePoll", () => ({
  usePoll: () => ({ start: vi.fn(), stop: vi.fn() }),
}));
vi.mock("@/api/modules/agents", () => ({ default: { models: { list: agentsList } } }));
vi.mock("@/api/modules/files", () => ({ default: { generateQuestionAndSummary: vi.fn() } }));
vi.mock("@/api/modules/prompt", () => ({ default: { list: vi.fn(async () => ({ prompts: [] })) } }));
vi.mock("@/api/modules/chunks", () => ({ default: { get: vi.fn() } }));
vi.mock("@/components/Markdown/helper", () => ({ markdownPreview: vi.fn() }));

describe("library file assistant thinking_mode", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    ["fast_9_1_same-model", 1],
    ["deep_9_1_same-model", 2],
  ] as const)("selected model option %s sends thinking_mode=%i", async (modelOption, thinkingMode) => {
    const ref = createRef<ChatRef>();
    render(
      <ChatAssistant
        ref={ref}
        agentInfo={{ agent_id: "agent-1", settings: {}, configs: {} }}
        fileInfo={{ id: "file-1", name: "doc.txt" }}
      />,
    );

    await waitFor(() => expect(agentsList).toHaveBeenCalled());
    if (modelOption.startsWith("deep_")) {
      await act(async () => {
        screen.getByRole("button", { name: modelOption }).click();
      });
    }

    await act(async () => {
      ref.current?.send({ textContent: "问题" });
    });

    await waitFor(() => expect(sendMessage).toHaveBeenCalled());
    expect(sendMessage.mock.calls[0][0]).toMatchObject({ thinkingMode });
  });
});
